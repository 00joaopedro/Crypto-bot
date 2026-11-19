import { createHash } from "node:crypto";
import { z } from "zod";
import { REGIME_CANDLE_MS } from "./btc-regime.js";
import { runPortfolioScenario, portfolioLimitsSchema, type PortfolioInstrument } from "./portfolio-comparison.js";
import { comparisonSchema } from "./strategy-comparison.js";
import { assertValidHistoricalCandles } from "./strategy-validation.js";
import { evaluateStrategy } from "./strategy.js";
import { assessMarketQuality } from "./signal-ranking.js";
import { requiredWalkForwardWarmup } from "./walk-forward.js";

export const universeStudySchema = z.object({
  endExclusiveUtc: z.iso.datetime(),
  days: z.literal(30), warmupCandles: z.number().int().min(96).max(2000),
  candleLimit: z.number().int().min(84).max(1000),
  sizes: z.array(z.number().int().min(0).max(1000)).min(2).max(10),
  fixedSymbols: z.array(z.string().regex(/^[A-Z0-9._-]+\/USDT$/)).max(50),
  minDailyQuoteVolumeUsdt: z.number().finite().nonnegative(),
  initialBalanceUsdt: z.number().finite().positive(), tradeSizeUsdt: z.number().finite().positive(),
  portfolio: portfolioLimitsSchema,
  parameters: comparisonSchema.shape.baseline,
  scenarios: comparisonSchema.shape.scenarios,
  collection: z.object({ maximumSymbols: z.number().int().min(100).max(1000), preferredSymbols: z.array(z.string().regex(/^[A-Z0-9._-]+\/USDT$/)).max(50) }).strict(),
}).strict().superRefine((study, ctx) => {
  if (new Set(study.sizes).size !== study.sizes.length || new Set(study.scenarios.map(s => s.name)).size !== study.scenarios.length) ctx.addIssue({ code: "custom", message: "Unique universe sizes and scenario names required" });
  const first = study.scenarios[0]!;
  if (!study.scenarios.slice(1).some(s => s.feeRate >= first.feeRate && s.slippageRate >= first.slippageRate && s.spreadRate >= first.spreadRate && (s.feeRate > first.feeRate || s.slippageRate > first.slippageRate || s.spreadRate > first.spreadRate))) ctx.addIssue({ code: "custom", message: "An adverse cost scenario is required" });
  if (study.warmupCandles < study.candleLimit - 1) ctx.addIssue({ code: "custom", message: "Warmup must cover the runtime candle window" });
  if (study.parameters.riskSizing) ctx.addIssue({ code: "custom", message: "Universe study uses identical fixed trade ceilings" });
  if (study.parameters.executionDelayCandles < 1) ctx.addIssue({ code: "custom", message: "At least one execution delay candle is required" });
  const required = requiredWalkForwardWarmup({ qualityFilters: true }, [study.parameters]);
  if (study.warmupCandles < required) ctx.addIssue({ code: "custom", message: `Need ${required} warmup candles` });
  if (Date.parse(study.endExclusiveUtc) % REGIME_CANDLE_MS) ctx.addIssue({ code: "custom", message: "Study end must align to 15m" });
});
export type UniverseStudy = z.infer<typeof universeStudySchema>;
export type UniverseDataset = PortfolioInstrument & { quoteVolumesUsdt: number[] };

export function datasetHash(dataset: UniverseDataset): string {
  return createHash("sha256").update(JSON.stringify(dataset)).digest("hex");
}

export function validateUniverseDatasets(datasets: UniverseDataset[], study: UniverseStudy): void {
  if (datasets.length < 2 || new Set(datasets.map(d => d.symbol)).size !== datasets.length) throw new Error("Need distinct aligned instruments");
  const end = Date.parse(study.endExclusiveUtc);
  const length = study.warmupCandles + study.days * 96;
  for (const dataset of datasets) {
    comparisonSchema.shape.constraints.parse(dataset.constraints);
    assertValidHistoricalCandles(dataset.candles);
    if (dataset.candles.length !== length || dataset.candles[0]!.timestamp !== end - length * REGIME_CANDLE_MS || dataset.candles.at(-1)!.timestamp !== end - REGIME_CANDLE_MS || dataset.quoteVolumesUsdt.length !== length || dataset.quoteVolumesUsdt.some(v => !Number.isFinite(v) || v < 0)) throw new Error(`Incomplete/alignment/quote-volume mismatch: ${dataset.symbol}`);
  }
  if (study.parameters.btcRegimeFilter && !datasets.some(d => d.symbol === "BTC/USDT")) throw new Error("BTC reference required");
}

/** Each membership decision reads only the last 96 completed candles. */
export function historicalUniverseRanks(datasets: UniverseDataset[], start: number, minimumVolume: number) {
  const length = datasets[0]!.candles.length;
  const ranks = new Map(datasets.map(d => [d.symbol, Array<number | undefined>(length)]));
  const totals = datasets.map(d => d.quoteVolumesUsdt.slice(start - 95, start + 1).reduce((a, b) => a + b, 0));
  const eligibleCounts: number[] = [];
  for (let index = start; index < length; index++) {
    if (index > start) for (let j = 0; j < datasets.length; j++) totals[j] = totals[j]! + datasets[j]!.quoteVolumesUsdt[index]! - datasets[j]!.quoteVolumesUsdt[index - 96]!;
    const order = datasets.map((d, j) => ({ symbol: d.symbol, volume: totals[j]! })).filter(d => d.volume >= minimumVolume)
      .sort((a, b) => b.volume - a.volume || a.symbol.localeCompare(b.symbol, "en"));
    eligibleCounts.push(order.length);
    order.forEach(({ symbol }, i) => { ranks.get(symbol)![index] = i; });
  }
  return { ranks, eligibleCounts };
}

export function compareUniverseSizes(rawDatasets: UniverseDataset[], rawStudy: unknown) {
  const study = universeStudySchema.parse(rawStudy);
  const datasets = [...rawDatasets].sort((a, b) => a.symbol.localeCompare(b.symbol, "en"));
  validateUniverseDatasets(datasets, study);
  const startedAt = performance.now();
  const start = study.warmupCandles;
  const holdout = start + 960, split = holdout + 960;
  const membership = historicalUniverseRanks(datasets, start, study.minDailyQuoteVolumeUsdt);
  const scores = new Map(datasets.map(d => [d.symbol, d.candles.map((_, index) => {
    if (index < start) return undefined;
    const candles = d.candles.slice(Math.max(0, index + 1 - study.candleLimit), index + 1);
    const signal = evaluateStrategy(candles, { minimumScore: study.parameters.minimumSignalScore, maxBuyRsi: study.parameters.maxBuyRsi ?? 70 });
    return signal.action === "BUY" && assessMarketQuality(candles).score >= 3 ? signal.score : undefined;
  })]));
  const btc = datasets.find(d => d.symbol === "BTC/USDT")?.candles;
  const mask = (size: number) => new Map(datasets.map(d => [d.symbol, scores.get(d.symbol)!.map((score, index) => {
    const rank = membership.ranks.get(d.symbol)![index];
    return rank !== undefined && (size === 0 || rank < size || study.fixedSymbols.includes(d.symbol)) ? score : undefined;
  })]));
  const run = (series: UniverseDataset[], masked: ReturnType<typeof mask>, from: number, scenario: UniverseStudy["scenarios"][number], boundary?: number) =>
    runPortfolioScenario(series, masked, from, study.parameters, scenario, study.portfolio, study.initialBalanceUsdt, study.tradeSizeUsdt, btc, boundary);
  const prefixes = datasets.map(d => ({ ...d, candles: d.candles.slice(0, holdout), quoteVolumesUsdt: d.quoteVolumesUsdt.slice(0, holdout) }));
  const calibration = study.sizes.map(size => ({ size, result: run(prefixes, mask(size), start, study.scenarios[0]!) }));
  const selected = [...calibration].sort((a, b) => b.result.netReturnUsdt - a.result.netReturnUsdt || a.result.maxDrawdownUsdt - b.result.maxDrawdownUsdt)[0]!;
  const results = study.sizes.map(size => ({
    size,
    scenarios: study.scenarios.map(scenario => {
      const result = run(datasets, mask(size), holdout, scenario, split);
      return { scenario, result, bothBlocksPositive: result.blocks!.every(b => b.netReturnUsdt > 0) };
    }),
  }));
  return {
    status: "exploratory_simulation_only", study,
    assets: datasets.map(d => ({ symbol: d.symbol, sha256: datasetHash(d), constraints: d.constraints, candleCount: d.candles.length })),
    coverage: { validatedAssets: datasets.length, requestedSizesCoveredByPool: study.sizes.every(n => n <= datasets.length), minimumLiquidCandidates: Math.min(...membership.eligibleCounts), maximumLiquidCandidates: Math.max(...membership.eligibleCounts) },
    calibration, selectedSizeFromCalibration: selected.size, results,
    durationMs: Math.round(performance.now() - startedAt),
    recommendation: "No automatic configuration change or real-money approval; compare frozen holdout results and validate Demo execution coverage.",
    limitations: [
      "Source pool is frozen from currently available OKX instruments, with a bounded predeclared collection cap. Delisted markets and historical instrument rules are unavailable: survivorship/coverage bias remains.",
      "Daily ranking uses actual quote volume from the last 96 completed candles. Historical spread/depth are unavailable; costs and depth are assumptions shared by every size.",
      "Size 0 means all validated assets in this source pool, not every market ever listed on OKX. More data does not prove edge or statistical certainty.",
      "D1-D10 selects size only; strategy parameters stay fixed. D11-D30 carries cash/positions through two 10-day blocks; the pool bias prevents treating this as an unbiased prospective test.",
      "Entry score ties use symbol order rather than the live ranking's quality/momentum tie-breakers.",
      "Portfolio replay is an idealized next-open execution. It does not reproduce scanner scheduling, universe-switch hysteresis, daily/consecutive-loss guards, account reconciliation, real fills or order-rate limits.",
      "Capital, fees, slippage, spread, trade ceilings and exposure limits are held fixed across universe sizes. No order is sent.",
    ],
  };
}
