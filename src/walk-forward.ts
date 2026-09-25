import { runBacktest, type BacktestMetrics, type BacktestOptions } from "./backtest.js";
import type { Candle } from "./types.js";

export type WalkForwardCandidate = Partial<Pick<BacktestOptions, "stopLossRate" | "takeProfitRate" | "minimumSignalScore" | "executionDelayCandles">>;
export type WalkForwardOptions = {
  trainCandles: number;
  testCandles: number;
  stepCandles?: number;
  candidates: WalkForwardCandidate[];
  base: BacktestOptions;
};
export type WalkForwardWindow = {
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  selected: WalkForwardCandidate;
  trainMetrics: BacktestMetrics;
  testMetrics: BacktestMetrics;
};
export type WalkForwardResult = {
  windows: WalkForwardWindow[];
  testedWindows: number;
  profitableWindows: number;
  consistencyPercent: number;
  averageTestReturnPercent: number;
  averageTestDrawdownPercent: number;
  overfitWarning: boolean;
};

/**
 * Walk-forward validation. Each test window is evaluated only after selecting
 * parameters from its preceding training window; no future candle is consulted.
 */
export function runWalkForward(candles: Candle[], options: WalkForwardOptions): WalkForwardResult {
  if (!Number.isInteger(options.trainCandles) || options.trainCandles < 50) throw new Error("trainCandles must be at least 50");
  if (!Number.isInteger(options.testCandles) || options.testCandles < 2) throw new Error("testCandles must be at least 2");
  if (options.candidates.length === 0) throw new Error("At least one candidate is required");
  const step = options.stepCandles ?? options.testCandles;
  if (!Number.isInteger(step) || step < 1) throw new Error("stepCandles must be a positive integer");
  const windows: WalkForwardWindow[] = [];
  for (let trainStart = 0; trainStart + options.trainCandles + options.testCandles <= candles.length; trainStart += step) {
    const trainEnd = trainStart + options.trainCandles;
    const testEnd = trainEnd + options.testCandles;
    const train = candles.slice(trainStart, trainEnd);
    const test = candles.slice(trainEnd, testEnd);
    const evaluated = options.candidates.map((candidate) => {
      const metrics = runBacktest(train, { ...options.base, ...candidate }).metrics;
      return { candidate, metrics, score: metrics.netReturnPercent - metrics.maxDrawdownPercent * 0.5 };
    }).sort((left, right) => right.score - left.score);
    const winner = evaluated[0]!;
    const testMetrics = runBacktest(test, { ...options.base, ...winner.candidate }).metrics;
    windows.push({ trainStart, trainEnd, testStart: trainEnd, testEnd, selected: winner.candidate, trainMetrics: winner.metrics, testMetrics });
  }
  if (windows.length === 0) throw new Error("Not enough candles for one walk-forward window");
  const profitableWindows = windows.filter((window) => window.testMetrics.netReturnPercent > 0).length;
  return {
    windows,
    testedWindows: windows.length,
    profitableWindows,
    consistencyPercent: (profitableWindows / windows.length) * 100,
    averageTestReturnPercent: average(windows.map((window) => window.testMetrics.netReturnPercent)),
    averageTestDrawdownPercent: average(windows.map((window) => window.testMetrics.maxDrawdownPercent)),
    overfitWarning: windows.some((window) => window.trainMetrics.netReturnPercent > 0 && window.testMetrics.netReturnPercent <= 0),
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
