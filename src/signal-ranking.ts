import { evaluateStrategy } from "./strategy.js";
import type { Candle, QuantSignal } from "./types.js";

export type SignalCandidate = { symbol: string; candles: Candle[] };

export type RankedSignal = {
  symbol: string;
  signal: QuantSignal;
  rank: number;
  eligible: boolean;
  marketQuality: MarketQuality;
};

export type MarketQuality = {
  score: number;
  historyAvailable: boolean;
  volumeHealthy: boolean;
  volatilityHealthy: boolean;
  candleHealthy: boolean;
};

export function rankSignals(
  candidates: SignalCandidate[],
  minimumScore?: number,
  blockedSymbols: ReadonlySet<string> = new Set(),
): RankedSignal[] {
  const ranked = candidates
    .map(({ symbol, candles }) => ({
      symbol,
      marketQuality: assessMarketQuality(candles),
      signal: minimumScore === undefined
        ? evaluateStrategy(candles)
        : evaluateStrategy(candles, { minimumScore }),
    }))
    .sort((left, right) => compareSignals(left.signal, right.signal, left.marketQuality, right.marketQuality));

  return ranked.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    eligible: candidate.signal.action === "BUY" && candidate.marketQuality.score >= 3 && !blockedSymbols.has(candidate.symbol),
  }));
}

function compareSignals(left: QuantSignal, right: QuantSignal, leftQuality: MarketQuality, rightQuality: MarketQuality): number {
  const actionDifference = Number(right.action === "BUY") - Number(left.action === "BUY");
  if (actionDifference !== 0) return actionDifference;
  if (right.score !== left.score) return right.score - left.score;
  if (rightQuality.score !== leftQuality.score) return rightQuality.score - leftQuality.score;
  if (right.scoreBreakdown.trend !== left.scoreBreakdown.trend) {
    return right.scoreBreakdown.trend - left.scoreBreakdown.trend;
  }
  return right.momentumPercent - left.momentumPercent;
}

function assessMarketQuality(candles: Candle[]): MarketQuality {
  const historyAvailable = candles.length >= 50;
  if (!historyAvailable) {
    return { score: 0, historyAvailable, volumeHealthy: false, volatilityHealthy: false, candleHealthy: false };
  }
  const recent = candles.slice(-20);
  const averageVolume = recent.reduce((sum, candle) => sum + candle.volume, 0) / recent.length;
  const volumeHealthy = Number.isFinite(averageVolume) && averageVolume > 0;
  const ranges = recent.map((candle) => Math.max(0, candle.high - candle.low) / Math.max(candle.close, 1));
  const averageRange = ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
  // Reject flat/invalid markets, but do not over-filter normal 15m crypto moves.
  const volatilityHealthy = Number.isFinite(averageRange) && averageRange >= 0.00005 && averageRange <= 0.15;
  const candleHealthy = recent.every((candle) =>
    Number.isFinite(candle.open) && Number.isFinite(candle.high) && Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) && Number.isFinite(candle.volume) && candle.high >= candle.low && candle.volume >= 0,
  );
  return {
    score: Number(historyAvailable) + Number(volumeHealthy) + Number(volatilityHealthy) + Number(candleHealthy),
    historyAvailable,
    volumeHealthy,
    volatilityHealthy,
    candleHealthy,
  };
}
