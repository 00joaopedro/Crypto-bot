import { emaSeries, rsiSeries } from "./indicators.js";
import type { Candle, QuantSignal } from "./types.js";

export const DEFAULT_MINIMUM_SIGNAL_SCORE = 5;

export type StrategyOptions = { minimumScore?: number; qualityFilters?: boolean };

export function evaluateStrategy(
  candles: Candle[],
  options: StrategyOptions = {},
): QuantSignal {
  const qualityFilters = options.qualityFilters !== false;
  if (candles.length < 50) {
    throw new Error("At least 50 closed candles are required");
  }
  if (qualityFilters && candles.length < 84) {
    return holdSignal(candles.at(-1)!, DEFAULT_MINIMUM_SIGNAL_SCORE, "At least 84 closed candles are required when quality filters are active");
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

  const bullishTrend = currentEma9 > currentEma21
    ? currentEma9 > previousEma9 ? 2 : 1
    : 0;
  const bearishTrend = currentEma9 < currentEma21
    ? currentEma9 < previousEma9 ? 2 : 1
    : 0;
  const rsiScore = currentRsi >= 45 && currentRsi <= 70
    ? 2
    : currentRsi >= 40 && currentRsi <= 75 ? 1 : 0;
  const volume = volumeRatio >= 0.9 ? 1 : 0;
  const momentum = momentumPercent > 0 ? 1 : 0;
  const bearishMomentum = momentumPercent < 0 ? 1 : 0;
  const volatility = volatilityPercent >= 0.1 && volatilityPercent <= 5 ? 1 : 0;
  const stopDistance = stopDistancePercent >= 0.3 && stopDistancePercent <= 3 ? 1 : 0;
  const bearishRsi = currentRsi <= 35 ? 2 : currentRsi <= 55 ? 1 : 0;
  const score = bullishTrend + rsiScore + volume + momentum + volatility + stopDistance;
  const sellScore = bearishTrend + bearishRsi + volume + bearishMomentum + volatility + stopDistance;
  // The EMA direction remains mandatory, but an exact one-candle crossover is
  // no longer required. The score and risk controls still control selectivity.
  const buyConfirmed = bullishTrend >= 1 && score >= minimumScore;
  const sellConfirmed = bearishTrend >= 1 && sellScore >= minimumScore && bearishMomentum === 1;
  const higherTrend = higherTimeframeTrend(candles);
  const lateralMarket = Math.abs(currentEma9 - currentEma21) / candle.close < Math.max(volatilityPercent / 100, 0.001) * 0.35;
  const weakVolume = volumeRatio < 0.9;
  const stretchedBuyRsi = currentRsi > 70;
  const stretchedSellRsi = currentRsi < 30;
  const buyQuality = higherTrend === 1 && !lateralMarket && !weakVolume && !stretchedBuyRsi;
  const sellQuality = higherTrend === -1 && !lateralMarket && !weakVolume && !stretchedSellRsi;
  const action = buyConfirmed && (!qualityFilters || buyQuality)
    ? "BUY"
    : sellConfirmed && (!qualityFilters || sellQuality)
      ? "SELL"
      : "HOLD";
  const scoreBreakdown = {
    trend: action === "SELL" ? bearishTrend : bullishTrend,
    rsi: action === "SELL" ? bearishRsi : rsiScore,
    volume,
    momentum: action === "SELL" ? bearishMomentum : momentum,
    volatility,
    stopDistance,
  };
  const contributingChecks = Object.entries(scoreBreakdown)
    .filter(([, points]) => points > 0)
    .map(([check]) => check)
    .join(", ");

  return {
    action,
    candleTimestamp: candle.timestamp,
    price: candle.close,
    ema9: currentEma9,
    ema21: currentEma21,
    previousEma9,
    previousEma21,
    rsi14: currentRsi,
    score: action === "SELL" ? sellScore : score,
    scoreThreshold: minimumScore,
    scoreBreakdown,
    volumeRatio,
    momentumPercent: action === "SELL" ? -Math.abs(momentumPercent) : momentumPercent,
    volatilityPercent,
    stopDistancePercent,
    reason: action === "BUY"
      ? `BUY score ${score}/8; higher-timeframe trend confirmed; contributing checks: ${contributingChecks || "none"}`
      : action === "SELL"
        ? `SELL score ${sellScore}/8; bearish trend and negative momentum confirmed`
        : `No directional signal; BUY score ${score}/8, SELL score ${sellScore}/8; quality filters: ${qualityFilters ? "active" : "disabled"}`,
  };
}

function higherTimeframeTrend(candles: Candle[]): -1 | 0 | 1 {
  const groups = new Map<number, Candle[]>();
  for (const candle of candles) {
    const bucket = Math.floor(candle.timestamp / (4 * 900_000));
    const group = groups.get(bucket) ?? [];
    group.push(candle); groups.set(bucket, group);
  }
  const aggregated: Candle[] = [];
  for (const group of [...groups.values()].sort((left, right) => left[0]!.timestamp - right[0]!.timestamp)) {
    if (group.length !== 4) continue;
    aggregated.push({ timestamp: group.at(-1)!.timestamp, open: group[0]!.open, high: Math.max(...group.map((c) => c.high)), low: Math.min(...group.map((c) => c.low)), close: group.at(-1)!.close, volume: group.reduce((sum, c) => sum + c.volume, 0) });
  }
  if (aggregated.length < 21) return 0;
  const closes = aggregated.map((c) => c.close);
  const fast = emaSeries(closes, 9); const slow = emaSeries(closes, 21);
  const currentFast = fast.at(-1)!; const currentSlow = slow.at(-1)!;
  if (currentFast > currentSlow && currentFast > fast.at(-2)!) return 1;
  if (currentFast < currentSlow && currentFast < fast.at(-2)!) return -1;
  return 0;
}

function holdSignal(candle: Candle, minimumScore: number, reason: string): QuantSignal {
  return { action: "HOLD", candleTimestamp: candle.timestamp, price: candle.close, ema9: candle.close, ema21: candle.close, previousEma9: candle.close, previousEma21: candle.close, rsi14: 50, score: 0, scoreThreshold: minimumScore, scoreBreakdown: { trend: 0, rsi: 0, volume: 0, momentum: 0, volatility: 0, stopDistance: 0 }, volumeRatio: 0, momentumPercent: 0, volatilityPercent: 0, stopDistancePercent: 0, reason };
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
