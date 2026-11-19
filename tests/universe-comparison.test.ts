import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { compareUniverseSizes, historicalUniverseRanks, universeStudySchema, validateUniverseDatasets, datasetHash, type UniverseDataset } from "../src/universe-comparison.js";
import { marketEntryBlock } from "../src/market-eligibility.js";

vi.mock("../src/strategy.js", () => ({ evaluateStrategy: () => ({ action: "BUY", score: 8 }) }));
const base = JSON.parse(readFileSync(new URL("../examples/universe-validation.study.json", import.meta.url), "utf8"));
const study = universeStudySchema.parse({ ...base, endExclusiveUtc: "2026-08-31T00:00:00Z", warmupCandles: 100,
  sizes: [1, 2, 0], fixedSymbols: [], minDailyQuoteVolumeUsdt: 0,
  portfolio: { maxConcurrentPositions: 1, maxExposureRate: 1, maxAltExposureRate: 1 },
  parameters: { stopLossRate: .01, takeProfitRate: .02, minimumSignalScore: 5, executionDelayCandles: 1 },
});
function datasets(): UniverseDataset[] {
  const start = Date.parse(study.endExclusiveUtc) - (study.warmupCandles + 2880) * 900000;
  return ["BTC/USDT", "ETH/USDT"].map((symbol, j) => ({ symbol,
    constraints: { minimumNotionalUsdt: 0, minimumQuantity: .01, quantityStep: .01 },
    candles: Array.from({ length: study.warmupCandles + 2880 }, (_, i) => ({ timestamp: start + i * 900000, open: 100, high: 103, low: 100, close: 100, volume: 1000 })),
    quoteVolumesUsdt: Array.from({ length: study.warmupCandles + 2880 }, () => j === 0 ? 100000 : 90000),
  }));
}

it("uses only completed trailing daily volume and does not peek at future volume", () => {
  const input = datasets();
  const before = historicalUniverseRanks(input, 96, 0);
  input[1]!.quoteVolumesUsdt[200] = 10000000;
  const after = historicalUniverseRanks(input, 96, 0);
  expect(after.ranks.get("ETH/USDT")!.slice(0, 200)).toEqual(before.ranks.get("ETH/USDT")!.slice(0, 200));
  expect(after.ranks.get("ETH/USDT")![200]).toBe(0);
  expect(after.ranks.get("ETH/USDT")![296]).toBe(1);
});

it("shares wallet, costs and limits across sizes and carries positions through both holdout blocks", () => {
  const report = compareUniverseSizes(datasets(), study);
  expect(report.results.map(r => r.size)).toEqual([1, 2, 0]);
  expect(report.results.every(r => r.scenarios.length === study.scenarios.length)).toBe(true);
  for (const row of report.results) for (const scenario of row.scenarios) {
    expect(scenario.result.peakConcurrentPositions).toBeLessThanOrEqual(1);
    expect(scenario.result.blocks).toHaveLength(2);
    const [first, second] = scenario.result.blocks!;
    expect(first!.endingEquityUsdt).toBe(second!.startingEquityUsdt);
    expect(first!.endExclusiveUtc).toBe(second!.startUtc);
    expect(first!.netReturnUsdt + second!.netReturnUsdt).toBeCloseTo(scenario.result.netReturnUsdt);
  }
  expect(report.limitations.join(" ")).toContain("survivorship");
});

it("freezes universe size selection on D1-D10 even when future prices and ranks change", () => {
  const original = datasets();
  const first = compareUniverseSizes(original, study);
  for (const data of original) for (let i = study.warmupCandles + 960; i < data.candles.length; i++) {
    data.candles[i] = { ...data.candles[i]!, high: 100, low: 98 };
    data.quoteVolumesUsdt[i] = data.quoteVolumesUsdt[i]! * (data.symbol === "ETH/USDT" ? 100 : .1);
  }
  const changed = compareUniverseSizes(original, study);
  expect(changed.calibration).toEqual(first.calibration);
  expect(changed.selectedSizeFromCalibration).toBe(first.selectedSizeFromCalibration);
  expect(changed.results[0]!.scenarios[0]!.result.netReturnUsdt).toBeLessThan(first.results[0]!.scenarios[0]!.result.netReturnUsdt);
});

it("rejects missing bars, duplicated instruments and unknown quote volume rather than filling holes", () => {
  const input = datasets();
  input[1]!.quoteVolumesUsdt.pop();
  expect(() => validateUniverseDatasets(input, study)).toThrow(/mismatch/);
  expect(() => validateUniverseDatasets([input[0]!, input[0]!], study)).toThrow(/distinct/);
  const gap = datasets(); gap[0]!.candles[200]!.timestamp += 900000;
  expect(() => validateUniverseDatasets(gap, study)).toThrow(/contiguous/);
});

it("reports an undersized source pool and hashes quote-volume evidence as well as candles", () => {
  const input = datasets();
  const first = datasetHash(input[0]!);
  input[0]!.quoteVolumesUsdt[100] = input[0]!.quoteVolumesUsdt[100]! + 1;
  expect(datasetHash(input[0]!)).not.toBe(first);
  expect(compareUniverseSizes(input, { ...study, sizes: [15, 100, 0] }).coverage.requestedSizesCoveredByPool).toBe(false);
});

it("requires unique sizes, adverse costs and a causal execution delay", () => {
  expect(() => universeStudySchema.parse({ ...study, sizes: [15, 15] })).toThrow();
  expect(() => universeStudySchema.parse({ ...study, parameters: { ...study.parameters, executionDelayCandles: 0 } })).toThrow();
  expect(() => universeStudySchema.parse({ ...study, scenarios: [study.scenarios[0], { ...study.scenarios[0], name: "same" }] })).toThrow();
});

it("uses OKX instrument categories without blacklisting valid X-prefixed cryptos", () => {
  const market = { symbol: "UNKNOWN/USDT", quote: "USDT", spot: true, active: true };
  expect(marketEntryBlock({ ...market, info: { instCategory: "3" } })).toBe("non_crypto_asset");
  expect(marketEntryBlock({ ...market, symbol: "XRP/USDT", info: { instCategory: "1" } })).toBeUndefined();
  expect(marketEntryBlock({ ...market, info: { instCategory: "3" } }, { excludeTokenizedAssets: false })).toBeUndefined();
});
