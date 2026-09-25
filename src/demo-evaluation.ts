import type { Candle } from "./types.js";

export type DemoClosedTrade = {
  symbol: string;
  entryTimestamp: number;
  exitTimestamp: number;
  netPnlUsdt: number;
};
export type DemoEvaluationOptions = { minimumOperations?: number; targetOperations?: number; regimeLookbackCandles?: number; regimeThresholdPercent?: number };
export type DemoBucketMetrics = { key: string; trades: number; wins: number; winRate: number; netPnlUsdt: number; averagePnlUsdt: number; profitFactor: number };
export type DemoEvaluation = {
  operations: number;
  minimumOperations: number;
  targetOperations: number;
  sampleReady: boolean;
  targetReached: boolean;
  bySymbol: DemoBucketMetrics[];
  byRegime: DemoBucketMetrics[];
  stableSymbols: string[];
  warnings: string[];
};

/** Evaluates accumulated Paper/OKX-Demo results without changing trading behavior. */
export function evaluateDemoPeriod(trades: DemoClosedTrade[], candles: Candle[], options: DemoEvaluationOptions = {}): DemoEvaluation {
  const minimumOperations = options.minimumOperations ?? 100;
  const targetOperations = options.targetOperations ?? 200;
  const lookback = options.regimeLookbackCandles ?? 20;
  const threshold = options.regimeThresholdPercent ?? 1;
  if (!Number.isInteger(minimumOperations) || minimumOperations < 1) throw new Error("minimumOperations must be positive");
  if (!Number.isInteger(targetOperations) || targetOperations < minimumOperations) throw new Error("targetOperations must be at least minimumOperations");
  if (!Number.isInteger(lookback) || lookback < 2) throw new Error("regimeLookbackCandles must be at least 2");
  const candleByTimestamp = new Map(candles.map((candle) => [candle.timestamp, candle]));
  const regimeFor = (timestamp: number): string => {
    const index = candles.findIndex((candle) => candle.timestamp === timestamp);
    if (index < lookback) return "UNKNOWN";
    const start = candles[index - lookback]!.close;
    const change = ((candles[index]!.close - start) / start) * 100;
    return change >= threshold ? "BULL" : change <= -threshold ? "BEAR" : "SIDEWAYS";
  };
  const validTrades = trades.filter((trade) => Number.isFinite(trade.netPnlUsdt) && candleByTimestamp.has(trade.exitTimestamp));
  const bySymbol = bucketMetrics(validTrades.map((trade) => ({ key: trade.symbol, pnl: trade.netPnlUsdt })));
  const byRegime = bucketMetrics(validTrades.map((trade) => ({ key: regimeFor(trade.exitTimestamp), pnl: trade.netPnlUsdt })));
  const stableSymbols = bySymbol.filter((bucket) => bucket.trades >= 10 && bucket.netPnlUsdt > 0 && bucket.winRate >= 45).map((bucket) => bucket.key);
  const warnings: string[] = [];
  if (validTrades.length < minimumOperations) warnings.push(`Amostra insuficiente: ${validTrades.length}/${minimumOperations} operações fechadas.`);
  if (byRegime.some((bucket) => bucket.key !== "UNKNOWN" && bucket.trades < 10)) warnings.push("Alguns regimes ainda têm poucas operações para uma conclusão confiável.");
  if (stableSymbols.length === 0 && validTrades.length >= minimumOperations) warnings.push("Nenhum par atingiu os critérios mínimos de estabilidade.");
  return { operations: validTrades.length, minimumOperations, targetOperations, sampleReady: validTrades.length >= minimumOperations, targetReached: validTrades.length >= targetOperations, bySymbol, byRegime, stableSymbols, warnings };
}

function bucketMetrics(values: Array<{ key: string; pnl: number }>): DemoBucketMetrics[] {
  const grouped = new Map<string, number[]>();
  for (const value of values) grouped.set(value.key, [...(grouped.get(value.key) ?? []), value.pnl]);
  return [...grouped.entries()].map(([key, pnls]) => {
    const wins = pnls.filter((pnl) => pnl > 0);
    const losses = Math.abs(pnls.filter((pnl) => pnl < 0).reduce((sum, pnl) => sum + pnl, 0));
    const netPnlUsdt = pnls.reduce((sum, pnl) => sum + pnl, 0);
    return { key, trades: pnls.length, wins: wins.length, winRate: (wins.length / pnls.length) * 100, netPnlUsdt, averagePnlUsdt: netPnlUsdt / pnls.length, profitFactor: losses === 0 ? (wins.length ? Number.POSITIVE_INFINITY : 0) : wins.reduce((sum, pnl) => sum + pnl, 0) / losses };
  }).sort((left, right) => right.netPnlUsdt - left.netPnlUsdt);
}
