import { emaSeries, rsiSeries } from "./indicators.js";
import type { Candle, QuantSignal } from "./types.js";

export function evaluateStrategy(candles: Candle[]): QuantSignal {
  if (candles.length < 50) {
    throw new Error("At least 50 closed candles are required");
  }

  const closes = candles.map((candle) => candle.close);
  const ema9 = emaSeries(closes, 9);
  const ema21 = emaSeries(closes, 21);
  const rsi14 = rsiSeries(closes, 14);

  const currentEma9 = ema9.at(-1)!;
  const previousEma9 = ema9.at(-2)!;
  const currentEma21 = ema21.at(-1)!;
  const previousEma21 = ema21.at(-2)!;
  const currentRsi = rsi14.at(-1)!;
  const candle = candles.at(-1)!;

  const bullishCross = previousEma9 <= previousEma21 && currentEma9 > currentEma21;
  const rsiAllowed = currentRsi >= 45 && currentRsi <= 70;
  const action = bullishCross && rsiAllowed ? "BUY" : "HOLD";

  return {
    action,
    candleTimestamp: candle.timestamp,
    price: candle.close,
    ema9: currentEma9,
    ema21: currentEma21,
    previousEma9,
    previousEma21,
    rsi14: currentRsi,
    reason: action === "BUY"
      ? "EMA9 crossed above EMA21 with RSI between 45 and 70"
      : "No valid bullish crossover on the latest closed candle",
  };
}
