import { z } from "zod";
import { tradeProfitConcentration } from "./backtest-performance.js";

const finite = z.number().finite();
const timestamp = finite.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const contextSchema = z.object({
  decisionTimestamp: timestamp,
  score: finite.min(0).max(8).optional(),
  rsi14: finite.min(0).max(100).optional(),
  btcState: z.enum(["allowed", "btc_regime_data_unavailable", "btc_regime_downtrend", "btc_regime_shock", "btc_regime_recovering", "unknown"]).optional(),
}).strict();
export type EntryDiagnosticContext = z.infer<typeof contextSchema>;
export const diagnosticTradeSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9._-]+\/USDT$/),
  entryTimestamp: timestamp, exitTimestamp: timestamp,
  entryPrice: finite.positive(), exitPrice: finite.positive(), quantity: finite.positive(),
  feesUsdt: finite.nonnegative(), netPnlUsdt: finite,
  reason: z.enum(["STOP_LOSS", "TAKE_PROFIT", "TRAILING_STOP", "SIGNAL_CONTRARY"]),
  configurationHash: hash.optional(),
  entryContext: contextSchema.optional(),
}).strict().superRefine((trade, ctx) => {
  if (trade.exitTimestamp < trade.entryTimestamp || (trade.entryContext && trade.entryContext.decisionTimestamp > trade.entryTimestamp)) {
    ctx.addIssue({ code: "custom", message: "Trade/context chronology is invalid" });
  }
  const gross = (trade.exitPrice - trade.entryPrice) * trade.quantity;
  const tolerance = Math.max(1, trade.entryPrice * trade.quantity) * 1e-8;
  if (Math.abs(gross - trade.feesUsdt - trade.netPnlUsdt) > tolerance) {
    ctx.addIssue({ code: "custom", message: "Price, quantity, fees and net P&L do not reconcile" });
  }
});
export type DiagnosticTrade = z.infer<typeof diagnosticTradeSchema>;

function metrics(trades: DiagnosticTrade[]) {
  const sum = (f: (trade: DiagnosticTrade) => number) => trades.reduce((n, t) => n + f(t), 0);
  const gains = sum(t => Math.max(0, t.netPnlUsdt)), losses = sum(t => Math.max(0, -t.netPnlUsdt));
  const gross = (t: DiagnosticTrade) => (t.exitPrice - t.entryPrice) * t.quantity;
  const grossGains = sum(t => Math.max(0, gross(t))), grossLosses = sum(t => Math.max(0, -gross(t)));
  const net = gains - losses;
  const wins = trades.filter(t => t.netPnlUsdt > 0).length, lossCount = trades.filter(t => t.netPnlUsdt < 0).length;
  const averageWin = wins ? gains / wins : null, averageLoss = lossCount ? losses / lossCount : null;
  return {
    closedTrades: trades.length, realizedPnlUsdt: net, beforeFeesPnlUsdt: sum(gross), feesUsdt: sum(t => t.feesUsdt),
    profitFactor: losses > 0 ? gains / losses : null,
    beforeFeesProfitFactor: grossLosses > 0 ? grossGains / grossLosses : null,
    expectancyUsdt: trades.length ? net / trades.length : null,
    winRatePercent: trades.length ? trades.filter(t => t.netPnlUsdt > 0).length / trades.length * 100 : null,
    losses: lossCount,
    averageWinUsdt: averageWin, averageLossUsdt: averageLoss,
    breakEvenWinRatePercent: averageWin !== null && averageLoss !== null ? averageLoss / (averageWin + averageLoss) * 100 : null,
    flatTrades: trades.filter(t => t.netPnlUsdt === 0).length,
    feeTurnedLosses: trades.filter(t => gross(t) >= 0 && t.netPnlUsdt < 0).length,
    averageEntryNotionalUsdt: trades.length ? sum(t => t.entryPrice * t.quantity) / trades.length : null,
    meanNetReturnBps: trades.length ? sum(t => t.netPnlUsdt / (t.entryPrice * t.quantity) * 10000) / trades.length : null,
    meanHoldingMinutes: trades.length ? sum(t => (t.exitTimestamp - t.entryTimestamp) / 60000) / trades.length : null,
    ...tradeProfitConcentration(trades.map(t => t.netPnlUsdt), gains, net),
  };
}

/** Explanatory accounting only: never selects a winner, changes risk or submits an order. */
export function diagnoseClosedTrades(input: unknown) {
  const trades = z.array(diagnosticTradeSchema).parse(input);
  const ids = new Map<string, DiagnosticTrade>();
  for (const trade of trades) {
    // One position per symbol in these engines. A duplicate must not double-count P&L.
    const key = `${trade.symbol}:${trade.entryTimestamp}:${trade.exitTimestamp}`;
    const previous = ids.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(trade)) throw new Error("Conflicting duplicate closed trade");
    ids.set(key, trade);
  }
  const unique = [...ids.values()].sort((a, b) => a.exitTimestamp - b.exitTimestamp || a.symbol.localeCompare(b.symbol));
  const groups = (key: (trade: DiagnosticTrade) => string) => {
    const buckets = new Map<string, DiagnosticTrade[]>();
    for (const trade of unique) { const k = key(trade); const group = buckets.get(k) ?? []; group.push(trade); buckets.set(k, group); }
    return [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => ({ key, ...metrics(rows) }));
  };
  const summary = metrics(unique);
  return {
    status: "descriptive_only", summary,
    duplicateRowsIgnored: trades.length - unique.length,
    bySymbol: groups(t => t.symbol), byExitReason: groups(t => t.reason),
    byEntryRsi: groups(t => {
      const rsi = t.entryContext?.rsi14;
      return rsi === undefined ? "unknown" : rsi < 45 ? "below45" : rsi <= 55 ? "45to55" : rsi <= 63 ? "above55to63" : rsi <= 70 ? "above63to70" : "above70";
    }),
    byBtcEntryState: groups(t => t.entryContext?.btcState ?? "unknown"),
    byConfiguration: groups(t => t.configurationHash ?? "unattributed"),
    byEntryNotional: groups(t => { const n = t.entryPrice * t.quantity; return n < 20 ? "below20usdt" : n < 100 ? "20to100usdt" : "atLeast100usdt"; }),
    warnings: [
      ...(unique.length < 30 ? ["Small closed-trade sample; subgroup comparisons are especially uncertain."] : []),
      ...(summary.beforeFeesPnlUsdt < 0 ? ["Filled-price P&L was negative even before subtracting fees; fee reduction alone does not explain these losses."] : []),
      ...(summary.feeTurnedLosses > 0 ? ["Some nonnegative filled-price trades became losses after fees. This does not justify ignoring their losses in safety controls."] : []),
      ...(unique.some(t => !t.configurationHash) ? ["Some opening configurations are unattributed; a current runtime snapshot is not assigned retroactively."] : []),
    ],
    limitations: [
      "Before-fees P&L already includes spread/slippage embedded in fill prices. It is an accounting decomposition, not a zero-cost replay or causal attribution of entry versus exit quality.",
      "Closed trades exclude open-position P&L and mark-to-market drawdown. Holding times use recorded timestamps, which may be candle timestamps rather than exchange execution times.",
      "Entry RSI and BTC filter state describe only available decision evidence; unknown values are not inferred from current prices or exit-time data. BTC state is a filter classification, not a general market-regime label.",
      "Per-symbol and per-RSI results are descriptive; do not remove pairs, optimize thresholds or claim independent validation from these subgroups.",
      "Profit factor is null without losses, including an empty sample. No configuration promotion or real-money approval is produced.",
    ],
  };
}

/** Normalize Paper events through an allowlist; do not treat Demo order responses as closed round trips. */
export function paperDiagnosticTrade(symbol: string, trade: {
  entryTimestamp: number; exitTimestamp: number; entryPrice: number; exitPrice: number; quantity: number;
  feesUsdt: number; netPnlUsdt: number; reason: string; configurationHash?: string;
}, entryContext?: EntryDiagnosticContext): DiagnosticTrade {
  return diagnosticTradeSchema.parse({ symbol, entryTimestamp: trade.entryTimestamp, exitTimestamp: trade.exitTimestamp,
    entryPrice: trade.entryPrice, exitPrice: trade.exitPrice, quantity: trade.quantity, feesUsdt: trade.feesUsdt,
    netPnlUsdt: trade.netPnlUsdt, reason: trade.reason,
    ...(trade.configurationHash ? { configurationHash: trade.configurationHash } : {}), ...(entryContext ? { entryContext } : {}),
  });
}
