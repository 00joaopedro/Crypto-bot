import { BTC_REGIME_HISTORY, REGIME_CANDLE_MS } from "./btc-regime.js";
import { positionSizingSchema } from "./position-sizing.js";
import { createHash } from "node:crypto";
import { exitPolicySchema } from "./exit-policy.js";
import { z } from "zod";
import { validateDemoStrategy } from "./strategy-validation.js";
import type { Candle } from "./types.js";

const rate = z.number().finite().min(0).lt(1);
const positive = z.number().finite().positive();
const parameters = z.object({
  exitPolicy: exitPolicySchema.optional(),
  riskSizing: positionSizingSchema.optional(),
  btcRegimeFilter: z.boolean().optional(),
  stopLossRate: positive.lt(1), takeProfitRate: positive.lt(1),
  minimumSignalScore: z.number().int().min(1).max(8),
  executionDelayCandles: z.number().int().min(0).max(96),
}).strict();
const scenario = z.object({
  name: z.string().min(1).max(80), feeRate: rate, slippageRate: rate,
  spreadRate: rate, assumedDepthUsdt: z.number().finite().nonnegative(),
  maxParticipationRate: positive.max(1),
}).strict();
export const comparisonSchema = z.object({
  symbol: z.string().min(1).max(40),
  dataSource: z.string().min(1).max(500),
  trainCandles: z.number().int().min(85), testCandles: z.number().int().min(2),
  initialBalanceUsdt: positive, tradeSizeUsdt: positive,
  constraints: z.object({ minimumNotionalUsdt: z.number().finite().nonnegative(), minimumQuantity: z.number().finite().nonnegative(), quantityStep: positive }).strict(),
  baseline: parameters,
  alternatives: z.array(z.object({ name: z.string().min(1).max(80), parameters }).strict()).min(1).max(8),
  scenarios: z.array(scenario).min(2).max(5),
}).strict();
export type ComparisonOptions = z.infer<typeof comparisonSchema>;

/** Fixed, predeclared alternatives. No selection or configuration is applied to the bot. */
export function compareDemoStrategies(candles: Candle[], rawOptions: ComparisonOptions, btcReference?: Candle[]) {
  const options = comparisonSchema.parse(rawOptions);
  if (new Set(options.scenarios.map(s => s.name)).size !== options.scenarios.length || new Set(["baseline", ...options.alternatives.map(a => a.name)]).size !== options.alternatives.length + 1) throw new Error("Names must be unique; baseline is reserved");
  const standard = options.scenarios[0]!;
  if (!options.scenarios.slice(1).some(s => s.feeRate >= standard.feeRate && s.slippageRate >= standard.slippageRate && s.spreadRate >= standard.spreadRate && s.assumedDepthUsdt <= standard.assumedDepthUsdt && s.maxParticipationRate <= standard.maxParticipationRate && (s.feeRate > standard.feeRate || s.slippageRate > standard.slippageRate || s.spreadRate > standard.spreadRate || s.assumedDepthUsdt < standard.assumedDepthUsdt || s.maxParticipationRate < standard.maxParticipationRate))) throw new Error("Include a strictly adverse cost/liquidity scenario after the standard scenario");
  const variants = [{ name: "baseline", parameters: options.baseline }, ...options.alternatives];
  const usesRegime = variants.some(v => v.parameters.btcRegimeFilter);
  const btcCandles = usesRegime ? btcReference ?? (options.symbol === "BTC/USDT" ? candles : undefined) : undefined;
  if (usesRegime) {
    if (!btcCandles?.length || !candles.length) throw new Error("BTC regime comparison requires a BTC/USDT reference series");
    if (btcCandles.some((c, i) => !Number.isFinite(c.close) || c.close <= 0 ||
      !Number.isSafeInteger(c.timestamp) || c.timestamp % REGIME_CANDLE_MS !== 0 ||
      (i > 0 && c.timestamp - btcCandles[i - 1]!.timestamp !== REGIME_CANDLE_MS))) {
      throw new Error("BTC reference must be valid contiguous 15m candles");
    }
    if (btcCandles[0]!.timestamp > candles[0]!.timestamp || btcCandles.at(-1)!.timestamp < candles.at(-1)!.timestamp ||
      candles[0]!.timestamp % REGIME_CANDLE_MS !== 0 || options.trainCandles < BTC_REGIME_HISTORY) {
      throw new Error("BTC reference must cover the aligned comparison period and training warmup");
    }
  }
  // The same training interval and indicator history are used by all alternatives.
  const results = options.scenarios.map(s => ({
    scenario: s,
    variants: variants.map(v => {
      const effectiveSlippage = (1 + s.slippageRate) * (1 + s.spreadRate / 2) - 1;
      if (effectiveSlippage >= 1) throw new Error("Combined execution cost is too high");
      const { exitPolicy, riskSizing, btcRegimeFilter, ...fixedParameters } = v.parameters;
      const candidate = { ...fixedParameters, ...(btcRegimeFilter !== undefined ? { btcRegimeFilter } : {}), ...(riskSizing ? { riskSizing } : {}), ...(exitPolicy ? { exitPolicy: { ...exitPolicy, exitFeeRate: s.feeRate, exitSlippageRate: effectiveSlippage } } : {}) };
      const report = validateDemoStrategy(candles, {
        trainCandles: options.trainCandles, testCandles: options.testCandles,
        candidates: [candidate],
        base: { symbol: options.symbol, initialBalanceUsdt: options.initialBalanceUsdt, tradeSizeUsdt: options.tradeSizeUsdt,
          feeRate: s.feeRate, slippageRate: effectiveSlippage,
          ...candidate, ...(btcCandles ? { btcCandles } : {}), qualityFilters: true, executionProfile: "demo-proxy",
          executionConstraints: options.constraints,
          liquidity: { assumedDepthUsdt: s.assumedDepthUsdt, maxParticipationRate: s.maxParticipationRate } },
      });
      const metrics = report.result.windows.map(w => w.testMetrics);
      const trades = metrics.reduce((n, m) => n + m.trades, 0);
      return { name: v.name, parameters: v.parameters, report,
        summary: {
          closedTrades: trades,
          meanWindowNetReturnPercent: report.result.averageTestReturnPercent,
          profitableWindowsPercent: report.result.consistencyPercent,
          worstWindowDrawdownPercent: Math.max(...metrics.map(m => m.maxDrawdownPercent)),
          closedTradeExpectancyUsdt: trades ? metrics.reduce((n, m) => n + m.expectancyUsdt * m.trades, 0) / trades : null,
          totalFeesUsdt: metrics.reduce((n, m) => n + m.totalFeesUsdt, 0),
          regimeBlockedSignals: metrics.reduce((n, m) => n + m.regimeBlockedSignals, 0),
          rejectedEntries: metrics.reduce((n, m) => n + m.rejectedEntries, 0),
          windowsWithOpenPosition: metrics.filter(m => m.openPositionAtEnd).length,
          evidence: trades < 30 || metrics.length < 3 ? "insufficient_sample" : "simulation_requires_independent_holdout",
        } };
    }),
  }));
  return {
    status: "simulation_only", options,
    dataset: { symbol: options.symbol, source: options.dataSource, candles: candles.length,
      firstTimestamp: candles[0]!.timestamp, lastTimestamp: candles.at(-1)!.timestamp,
      sha256: createHash("sha256").update(JSON.stringify(candles)).digest("hex") },
    ...(btcCandles ? { btcReference: { symbol: "BTC/USDT", candles: btcCandles.length, sha256: createHash("sha256").update(JSON.stringify(btcCandles)).digest("hex") } } : {}),
    results,
    limitations: [
      "Predeclare alternatives before viewing test outcomes; comparing many alternatives can overfit the test data.",
      "All windows start with fresh capital and no position. Returns are not a continuous portfolio result or compounded profit.",
      "Spread, depth, fees and slippage are supplied assumptions, not observed historical OKX liquidity. No order-book reconstruction is claimed.",
      "Participation uses previous candle base volume times its close; supply base-asset volume, not quote volume or contracts.",
      "Entries use next open, rounded quantity and minimums. Full fills are assumed; partial fills, portfolio risk and dynamic pair selection are not reproduced.",
      "Open positions are marked to market with an estimated fee; their eventual liquidation and slippage are not realized trades.",
      "No automatic winner, live configuration change, order, or profitability certification is produced.",
    ],
  };
}
