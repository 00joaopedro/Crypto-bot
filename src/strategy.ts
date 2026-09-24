import { emaSeries, rsiSeries } from "./indicators.js";
import type { Candle, QuantSignal } from "./types.js";

export const DEFAULT_MINIMUM_SIGNAL_SCORE = 5;

type StrategyOptions = { minimumScore?: number };

export function evaluateStrategy(
  candles: Candle[],
  options: StrategyOptions = {},
): QuantSignal {
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
  const minimumScore = options.minimumScore ?? DEFAULT_MINIMUM_SIGNAL_SCORE;
  if (!Number.isInteger(minimumScore) || minimumScore < 1 || minimumScore > 8) {
    throw new Error("minimumScore must be an integer between 1 and 8");
  }

  const averageVolume = average(candles.slice(-20).map((item) => item.volume));
  const volumeRatio = averageVolume > 0 ? candle.volume / averageVolume : 0;
  const momentumPercent = percentageChange(closes.at(-4)!, candle.close);
  const volatilityPercent = atrPercent(candles.slice(-15), candle.close);
  // This is a tradability check only; the actual stop remains controlled by
  // PaperTrader and the OKX Demo executor settings.
  const stopDistancePercent = volatilityPercent * 1.5;

  const trend = currentEma9 > currentEma21
    ? currentEma9 > previousEma9 ? 2 : 1
    : 0;
  const rsiScore = currentRsi >= 45 && currentRsi <= 70
    ? 2
    : currentRsi >= 40 && currentRsi <= 75 ? 1 : 0;
  const volume = volumeRatio >= 0.9 ? 1 : 0;
  const momentum = momentumPercent > 0 ? 1 : 0;
  const volatility = volatilityPercent >= 0.1 && volatilityPercent <= 5 ? 1 : 0;
  const stopDistance = stopDistancePercent >= 0.3 && stopDistancePercent <= 3 ? 1 : 0;
  const score = trend + rsiScore + volume + momentum + volatility + stopDistance;

  // The EMA direction remains mandatory, but an exact one-candle crossover is
  // no longer required. The score and AI filter still control selectivity.
  const action = trend >= 1 && score >= minimumScore ? "BUY" : "HOLD";

  return {
    action,
    candleTimestamp: candle.timestamp,
    price: candle.close,
    ema9: currentEma9,
    ema21: currentEma21,
    previousEma9,
    previousEma21,
    rsi14: currentRsi,
    score,
    scoreThreshold: minimumScore,
    scoreBreakdown: {
      trend,
      rsi: rsiScore,
      volume,
      momentum,
      volatility,
      stopDistance,
    },
    volumeRatio,
    momentumPercent,
    volatilityPercent,
    stopDistancePercent,
    reason: action === "BUY"
      ? `Signal score ${score}/8: trend, momentum and risk checks passed`
      : `Signal score ${score}/8 below threshold ${minimumScore} or trend not confirmed`,
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentageChange(start: number, end: number): number {
  return start === 0 ? 0 : ((end - start) / start) * 100;
}

function atrPercent(candles: Candle[], referencePrice: number): number {
  if (candles.length < 2 || referencePrice <= 0) return 0;
  let totalTrueRange = 0;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]!;
    const previousClose = candles[index - 1]?.close ?? candle.open;
    totalTrueRange += Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  }
  return (totalTrueRange / candles.length / referencePrice) * 100;
}
