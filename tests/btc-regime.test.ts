import { expect, it } from "vitest";
import { btcRegimeBlock, BTC_REGIME_HISTORY, REGIME_CANDLE_MS } from "../src/btc-regime.js";

const bar = (i: number, close = 100) => ({
  timestamp: i * REGIME_CANDLE_MS, open: close, close, high: close, low: close, volume: 1,
});

it("blocks a shock or downtrend immediately and waits for three favorable closes", () => {
  const stable = Array.from({ length: BTC_REGIME_HISTORY }, (_, i) => bar(i));
  const shock = [...stable, bar(98, 97)];
  expect(btcRegimeBlock(shock, bar(98).timestamp)).toBe("btc_regime_shock");
  expect(btcRegimeBlock([...stable, bar(98, 99)], bar(98).timestamp)).toBe("btc_regime_downtrend");

  const recovery = [...shock, bar(99), bar(100), bar(101)];
  expect(btcRegimeBlock(recovery, bar(100).timestamp, 100)).toBe("btc_regime_recovering");
  expect(btcRegimeBlock(recovery, bar(101).timestamp, 101)).toBeUndefined();
});

it("rejects missing history, gaps, invalid prices and an unmatched timestamp without reading future bars", () => {
  const stable = Array.from({ length: BTC_REGIME_HISTORY }, (_, i) => bar(i));
  const timestamp = stable.at(-1)!.timestamp;
  expect(btcRegimeBlock([...stable, bar(98, 1)], timestamp, 97)).toBeUndefined();
  expect(btcRegimeBlock(stable.slice(1), timestamp)).toBe("btc_regime_data_unavailable");
  expect(btcRegimeBlock(stable, timestamp + REGIME_CANDLE_MS)).toBe("btc_regime_data_unavailable");
  const gap = [...stable]; gap[20] = bar(21);
  expect(btcRegimeBlock(gap, timestamp)).toBe("btc_regime_data_unavailable");
  const invalid = [...stable]; invalid[20] = bar(20, NaN);
  expect(btcRegimeBlock(invalid, timestamp)).toBe("btc_regime_data_unavailable");
});
