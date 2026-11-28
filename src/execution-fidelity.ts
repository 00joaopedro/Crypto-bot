import { DEFAULT_MAX_BUY_RSI } from "./strategy.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { parseConfig } from "./config.js";
import type { DashboardSettings, RecoveryState } from "./persistence.js";
import { exitPolicySchema, type ExitPolicy } from "./exit-policy.js";
import { universeStudySchema } from "./universe-comparison.js";
import { comparisonSlippage } from "./strategy-comparison.js";

// Explicit allowlist: credentials, connection strings and personal data are never captured.
export const FIDELITY_CONFIG_KEYS = [
  "ENVIRONMENT", "EXECUTION_PROVIDER", "LIVE_TRADING_ENABLED", "OKX_DEMO_TRADING_ENABLED", "MARKET_DATA_PROVIDER", "MARKET_DATA_FALLBACK_PROVIDER",
  "COMPILED_MAX_BUY_RSI", "SYMBOL", "TIMEFRAME", "CANDLE_LIMIT", "LOOP_DELAY_MS", "AI_MODE", "GEMINI_ENABLED", "GEMINI_MODEL", "AI_FAILURE_MODE", "MIN_AI_CONFIDENCE", "MIN_SIGNAL_SCORE",
  "PAPER_INITIAL_BALANCE_USDT", "PAPER_TRADE_SIZE_USDT", "PAPER_FEE_RATE", "PAPER_SLIPPAGE_RATE", "PAPER_STOP_LOSS_RATE", "PAPER_TAKE_PROFIT_RATE",
  "OKX_DEMO_ORDER_SIZE_USDT", "OKX_DEMO_STOP_LOSS_RATE", "OKX_DEMO_TAKE_PROFIT_RATE", "OKX_DEMO_MAX_SPREAD_PERCENT", "OKX_DEMO_BOT_BUDGET_USDT",
  "EXIT_MANAGEMENT_ENABLED", "EXIT_MODE", "EXIT_BREAKEVEN_ENABLED", "EXIT_TRAILING_ATR_MULTIPLIER", "EXIT_ACTIVATION_RATE", "EXIT_FEE_RATE", "EXIT_SLIPPAGE_RATE",
  "ATR_PERIOD", "ATR_STOP_MULTIPLIER", "ATR_TAKE_PROFIT_MULTIPLIER", "ATR_MIN_STOP_RATE", "ATR_MAX_STOP_RATE", "BTC_REGIME_FILTER_ENABLED",
  "RISK_SIZING_ENABLED", "RISK_PER_TRADE_PERCENT", "RISK_MAX_EXPOSURE_PERCENT", "RISK_MAX_ALT_EXPOSURE_PERCENT", "RISK_MAX_SYMBOL_EXPOSURE_PERCENT",
  "RISK_MAX_DAILY_LOSS_PERCENT", "RISK_MAX_DRAWDOWN_PERCENT", "RISK_MAX_CONSECUTIVE_LOSSES", "RISK_MAX_TRADES_PER_HOUR", "MAX_CONCURRENT_POSITIONS", "ENTRY_COOLDOWN_MINUTES", "STOP_LOSS_COOLDOWN_MINUTES", "AUTO_RESUME_ENABLED", "AUTO_RESUME_LOSS_COOLDOWN_MINUTES",
  "PAIR_COOLDOWN_ENABLED", "PAIR_COOLDOWN_HOURS", "PAIR_COOLDOWN_MIN_LOSSES", "SIGNAL_SCAN_SYMBOLS", "SIGNAL_EXCLUDED_SYMBOLS", "SIGNAL_EXCLUDE_STABLECOINS", "SIGNAL_EXCLUDE_TOKENIZED_ASSETS",
  "DYNAMIC_UNIVERSE_SIZE", "MARKET_MIN_QUOTE_VOLUME_USDT", "MARKET_MAX_SPREAD_PERCENT", "SIGNAL_SCAN_CONCURRENCY", "SIGNAL_SCAN_REQUEST_BUDGET", "SIGNAL_SCAN_TIME_BUDGET_MS",
  "UNIVERSE_SWITCH_COOLDOWN_MINUTES", "UNIVERSE_SWITCH_MIN_SCORE_ADVANTAGE", "UNIVERSE_MAX_REPLACEMENTS",
] as const;
const publicValue = z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string()), z.null()]);
const settingsSchema = z.object({ symbol: z.string().max(40), demoOrderCeilingUsdt: z.number().positive(), paperOrderCeilingUsdt: z.number().positive(), paperSizeSource: z.enum(["dashboard", "environment"]), maxPositions: z.number().int().positive(), demoOrdersPerInterval: z.number().int().positive(), intervalMinutes: z.number().int().positive() }).strict();
const snapshotSchema = z.object({
  schemaVersion: z.literal(1), capturedAtUtc: z.iso.datetime(), configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.object({ commitSha: z.string().regex(/^[a-f0-9]{40}$/).nullable(), deploymentId: z.string().max(80).nullable() }).strict(),
  configuration: z.record(z.enum(FIDELITY_CONFIG_KEYS), publicValue), settings: settingsSchema,
  exitPolicy: exitPolicySchema.nullable(), restoredPaperPosition: z.boolean(), restoredPaperExitPolicy: exitPolicySchema.nullable(),
}).strict();
export type EffectiveExecutionSnapshot = z.infer<typeof snapshotSchema>;
export const tradingTermsSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("confirmed"), symbol: z.string().max(40), observedAtUtc: z.iso.datetime(), takerFeeRate: z.number().finite().min(0).lt(1), minimumQuantity: z.number().finite().positive(), quantityStep: z.number().finite().positive() }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["demo_disabled", "query_failed", "fee_unconfirmed", "instrument_unconfirmed", "not_initialized", "query_pending"]) }).strict(),
]);
export type TradingTerms = z.infer<typeof tradingTermsSchema>;
export class TradingTermsCache {
  private readonly entries = new WeakMap<object, Map<string, { expires: number; request: Promise<TradingTerms> }>>();
  constructor(private readonly now: () => number = Date.now) {}
  read(client: { inspectTradingTerms(symbol: string): Promise<TradingTerms> }, symbol: string): Promise<TradingTerms> {
    let entries = this.entries.get(client);
    if (!entries) { entries = new Map(); this.entries.set(client, entries); }
    const cached = entries.get(symbol);
    if (cached && this.now() < cached.expires) return cached.request;
    if (entries.size >= 100 && !entries.has(symbol)) {
      const oldest = [...entries].find(([,v]) => v.expires !== Infinity);
      if (oldest) entries.delete(oldest[0]);
      else return Promise.resolve({ status: "unavailable", reason: "query_pending" });
    }
    const item = { expires: Infinity, request: Promise.resolve({ status: "unavailable", reason: "query_pending" } as TradingTerms) };
    item.request = Promise.resolve().then(() => client.inspectTradingTerms(symbol))
      .then(value => { const terms = tradingTermsSchema.parse(value); if (terms.status === "confirmed" && terms.symbol !== symbol) throw new Error("Quote symbol mismatch"); return terms; })
      .catch((): TradingTerms => ({ status: "unavailable", reason: "query_failed" }))
      .finally(() => { item.expires = this.now() + 60000; });
    entries.set(symbol, item);
    return item.request;
  }
  /** On-demand export only: at most 20 pairs, two read-only requests and a 5s response budget. */
  async readBatch(client: { inspectTradingTerms(symbol: string): Promise<TradingTerms> }, symbols: string[], budgetMs = 5000) {
    const unique = [...new Set(symbols)].filter(s => /^[A-Z0-9._-]+\/USDT$/.test(s));
    const selected = unique.slice(0, 20), results = new Map<string, TradingTerms>();
    let cursor = 0, stopped = false;
    const worker = async () => { while (!stopped && cursor < selected.length) { const symbol = selected[cursor++]!; results.set(symbol, await this.read(client, symbol)); } };
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all([worker(), worker()]), new Promise<void>(resolve => { timer = setTimeout(() => { stopped = true; resolve(); }, budgetMs); })]);
    if (timer) clearTimeout(timer); stopped = true;
    return { quotes: selected.map(symbol => ({ symbol, terms: results.get(symbol) ?? { status: "unavailable" as const, reason: "query_pending" as const } })),
      coverage: { requested: selected.length, completed: results.size, pending: selected.length - results.size, truncated: unique.length - selected.length } };
  }
}

function fingerprint(snapshot: Pick<EffectiveExecutionSnapshot, "configuration" | "settings" | "exitPolicy">): string {
  return createHash("sha256").update(JSON.stringify({ configuration: snapshotSchema.shape.configuration.parse(snapshot.configuration), settings: settingsSchema.parse(snapshot.settings), exitPolicy: snapshotSchema.shape.exitPolicy.parse(snapshot.exitPolicy) })).digest("hex");
}
export function effectiveExecutionSnapshot(config: ReturnType<typeof parseConfig>, settings: DashboardSettings, policy: ExitPolicy | undefined, recovery?: RecoveryState, source: { commitSha?: string; deploymentId?: string } = {}): EffectiveExecutionSnapshot {
  const data = {
    configuration: Object.fromEntries(FIDELITY_CONFIG_KEYS.map(key => [key, key === "COMPILED_MAX_BUY_RSI" ? DEFAULT_MAX_BUY_RSI : config[key] ?? null])) as EffectiveExecutionSnapshot["configuration"],
    settings: { symbol: settings.symbol, demoOrderCeilingUsdt: settings.orderSizeUsdt, paperOrderCeilingUsdt: settings.paperTradeSizeUsdt ?? config.PAPER_TRADE_SIZE_USDT,
      paperSizeSource: settings.paperTradeSizeUsdt == null ? "environment" as const : "dashboard" as const,
      maxPositions: settings.maxConcurrentPositions, demoOrdersPerInterval: settings.maxTrades, intervalMinutes: settings.intervalMinutes },
    exitPolicy: policy ?? null,
  };
  return snapshotSchema.parse({ ...data, schemaVersion: 1, capturedAtUtc: new Date().toISOString(), configurationHash: fingerprint(data),
    source: { commitSha: /^[a-f0-9]{40}$/.test(source.commitSha ?? "") ? source.commitSha : null,
      deploymentId: /^[a-f0-9-]{36}$/.test(source.deploymentId ?? "") ? source.deploymentId : null },
    restoredPaperPosition: Boolean(recovery?.paperState.position), restoredPaperExitPolicy: recovery?.paperState.position?.exitPolicy ?? null });
}
export function validateExecutionSnapshot(input: unknown): EffectiveExecutionSnapshot {
  const snapshot = snapshotSchema.parse(input);
  if (snapshot.configurationHash !== fingerprint(snapshot)) throw new Error("Execution configuration hash mismatch");
  return snapshot;
}
export function executionFidelityReport(input: unknown, rawTerms: TradingTerms, rawStudy?: unknown) {
  const terms = tradingTermsSchema.parse(rawTerms);
  const snapshot = validateExecutionSnapshot(input);
  const findings: Array<{ id: string; status: "difference" | "limitation" | "unknown"; detail: string; observed?: unknown; expected?: unknown }> = [];
  const difference = (id: string, observed: unknown, expected: unknown, detail: string) => {
    if (JSON.stringify(observed) !== JSON.stringify(expected)) findings.push({ id, status: "difference", observed, expected, detail });
  };
  const c = snapshot.configuration, s = snapshot.settings;
  if (!snapshot.source.commitSha) findings.push({ id: "code_identity", status: "unknown", detail: "Commit identity was not provided by the runtime; configuration hash alone does not identify strategy code." });
  difference("paper_demo_size", s.paperOrderCeilingUsdt, s.demoOrderCeilingUsdt, "Paper and Demo order ceilings differ; neither ceiling proves the actual filled size.");
  if (terms.status === "confirmed" && terms.symbol === s.symbol && Number.isFinite(terms.takerFeeRate) && terms.takerFeeRate >= 0 && terms.takerFeeRate < 1) {
    difference("paper_account_fee", c.PAPER_FEE_RATE, terms.takerFeeRate, "Configured Paper fee differs from the read-only taker quote for this Demo instrument, not necessarily every pair.");
  } else findings.push({ id: "account_fee", status: "unknown", detail: "No verified account fee for the principal pair. A configured rate is not an observed fee." });
  if (!snapshot.exitPolicy) findings.push({ id: "legacy_trailing_mismatch", status: "difference", detail: "With managed exits disabled, live Paper receives a legacy percentage trailing rate from the ATR entry calculation. Demo attaches fixed SL/TP and has no equivalent legacy trailing manager. Disabled managed exits does not mean identical fixed exits in both engines." });
  if (snapshot.restoredPaperPosition) findings.push({ id: "restored_policy", status: "limitation", detail: "A restored position can retain its original exit policy; current settings do not relabel historical trades or other recovered positions." });
  if (rawStudy !== undefined) {
    const study = universeStudySchema.parse(rawStudy);
    difference("paper_initial_capital", c.PAPER_INITIAL_BALANCE_USDT, study.initialBalanceUsdt, "Historical wallet differs from configured Paper starting capital; current equity is not inferred.");
    difference("paper_study_size", s.paperOrderCeilingUsdt, study.tradeSizeUsdt, "Paper ceiling versus fixed historical trade ceiling.");
    difference("demo_study_size", s.demoOrderCeilingUsdt, study.tradeSizeUsdt, "Demo ceiling versus historical ceiling; risk sizing and instrument precision can reduce actual fills.");
    difference("candle_window", c.CANDLE_LIMIT, study.candleLimit, "Indicator initialization depends on the available candle window.");
    difference("max_buy_rsi", c.COMPILED_MAX_BUY_RSI, study.parameters.maxBuyRsi ?? DEFAULT_MAX_BUY_RSI, "Compiled live default versus the historical RSI ceiling; this is not a Railway variable.");
    difference("entry_atr", { period: c.ATR_PERIOD, stopMultiplier: c.ATR_STOP_MULTIPLIER, targetMultiplier: c.ATR_TAKE_PROFIT_MULTIPLIER, minStopRate: c.ATR_MIN_STOP_RATE, maxStopRate: c.ATR_MAX_STOP_RATE },
      study.parameters.exitPolicy ? { period: study.parameters.exitPolicy.atrPeriod, stopMultiplier: study.parameters.exitPolicy.stopMultiplier, targetMultiplier: study.parameters.exitPolicy.targetMultiplier, minStopRate: study.parameters.exitPolicy.minStopRate, maxStopRate: study.parameters.exitPolicy.maxStopRate } : null,
      "Live entries compute clamped ATR rates even without a managed exit policy. Historical entries use ATR only when the study has an exit policy.");
    difference("signal_score", c.MIN_SIGNAL_SCORE, study.parameters.minimumSignalScore, "Live and historical minimum score.");
    difference("btc_regime", c.BTC_REGIME_FILTER_ENABLED, Boolean(study.parameters.btcRegimeFilter), "BTC entry filter must be compared explicitly.");
    difference("exit_policy", snapshot.exitPolicy, study.parameters.exitPolicy ?? null, "Managed-exit policy differs. With management disabled, the live bot still computes clamped ATR entry levels and permits Paper contrary-signal exits.");
    difference("paper_fee", c.PAPER_FEE_RATE, study.scenarios[0]!.feeRate, "Paper rate versus the standard study assumption per side.");
    difference("paper_execution_cost", c.PAPER_SLIPPAGE_RATE, comparisonSlippage(study.scenarios[0]!), "Historical execution combines slippage and half the modeled spread per leg; Paper does not fill from the observed order book.");
    difference("total_exposure", c.RISK_MAX_EXPOSURE_PERCENT, study.portfolio.maxExposureRate, "Shared exposure limits differ.");
    difference("alt_exposure", { enabled: c.RISK_SIZING_ENABLED === true, rate: c.RISK_SIZING_ENABLED === true ? c.RISK_MAX_ALT_EXPOSURE_PERCENT : null },
      { enabled: true, rate: study.portfolio.maxAltExposureRate },
      "The historical portfolio always enforces its altcoin cap. Live Paper only enforces the dedicated altcoin cap when risk sizing is enabled; a dormant configured value is not an active constraint.");
    difference("position_sizing", c.RISK_SIZING_ENABLED, false, "The universe study uses fixed trade ceilings; live risk sizing can reduce quantity according to stop distance and remaining exposure.");
    difference("positions", s.maxPositions, study.portfolio.maxConcurrentPositions, "Concurrent position limits differ.");
    difference("pair_cooldown", c.PAIR_COOLDOWN_ENABLED ? { hours: c.PAIR_COOLDOWN_HOURS, minLosses: c.PAIR_COOLDOWN_MIN_LOSSES } : null, study.parameters.pairCooldown ?? null, "Pair-loss pauses change the admitted trade sample.");
    if (terms.status === "confirmed" && terms.symbol === s.symbol) difference("study_account_fee", study.scenarios[0]!.feeRate, terms.takerFeeRate, "Historical standard fee versus current quoted taker fee; quote is not a reconstruction of historical fees.");
  }
  findings.push(
    { id: "paper_demo_fills", status: "limitation", detail: "Paper simulates candle fills and configured costs; Demo uses confirmed exchange fills, precision and fees (including base-currency fees). Spread checks do not make Paper and Demo fills identical." },
    { id: "paper_demo_exits", status: "limitation", detail: "Paper uses candle OHLC and overrides managed breakeven fee/slippage with its configured Paper costs. Demo uses native conditional protections and account fee evidence; trailing amendments require exchange acknowledgement/reconciliation. Contrary-signal Demo market sells remain disabled; no equivalence is assumed." },
    { id: "portfolio_replay", status: "limitation", detail: "Historical portfolio replay does not reproduce live scheduling, ranking tie-breakers, daily/consecutive-loss controls or all order-rate and reconciliation gates." },
    { id: "history_attribution", status: "limitation", detail: "This snapshot describes current applied settings only. Historical records without a configuration hash are unattributed, not retroactively assigned to this configuration." },
    { id: "demo_capital", status: "unknown", detail: "Demo free USDT, bot budget, marked account equity and confirmed fills must be checked separately; Paper initial balance is not Demo capital." },
  );
  return { status: "equivalence_not_established", snapshot, tradingTerms: terms, findings };
}
