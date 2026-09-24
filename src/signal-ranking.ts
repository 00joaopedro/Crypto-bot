import { evaluateStrategy } from "./strategy.js";
import type { Candle, QuantSignal } from "./types.js";

export type SignalCandidate = { symbol: string; candles: Candle[] };

export type RankedSignal = {
  symbol: string;
  signal: QuantSignal;
  rank: number;
  eligible: boolean;
};

export function rankSignals(
  candidates: SignalCandidate[],
  minimumScore?: number,
): RankedSignal[] {
  const ranked = candidates
    .map(({ symbol, candles }) => ({
      symbol,
      signal: minimumScore === undefined
        ? evaluateStrategy(candles)
        : evaluateStrategy(candles, { minimumScore }),
    }))
    .sort((left, right) => compareSignals(left.signal, right.signal));

  return ranked.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    eligible: candidate.signal.action === "BUY",
  }));
}

function compareSignals(left: QuantSignal, right: QuantSignal): number {
  const actionDifference = Number(right.action === "BUY") - Number(left.action === "BUY");
  if (actionDifference !== 0) return actionDifference;
  if (right.score !== left.score) return right.score - left.score;
  if (right.scoreBreakdown.trend !== left.scoreBreakdown.trend) {
    return right.scoreBreakdown.trend - left.scoreBreakdown.trend;
  }
  return right.momentumPercent - left.momentumPercent;
}
