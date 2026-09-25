import { PaperTrader, type PaperTradeClosed } from "./paper-trader.js";
import { evaluateStrategy } from "./strategy.js";
import type { Candle } from "./types.js";

export type BacktestOptions = {
  initialBalanceUsdt: number;
  tradeSizeUsdt: number;
  feeRate: number;
  slippageRate: number;
  stopLossRate: number;
  takeProfitRate: number;
  executionDelayCandles?: number;
  minimumSignalScore?: number;
};

export type BacktestMetrics = {
  initialBalanceUsdt: number;
  finalEquityUsdt: number;
  netReturnUsdt: number;
  netReturnPercent: number;
  buyAndHoldEquityUsdt: number;
  buyAndHoldReturnPercent: number;
  excessReturnVsBuyAndHoldPercent: number;
  grossProfitUsdt: number;
  grossLossUsdt: number;
  totalFeesUsdt: number;
  profitFactor: number;
  expectancyUsdt: number;
  winRate: number;
  trades: number;
  wins: number;
  losses: number;
  maxDrawdownPercent: number;
  executionDelayCandles: number;
};

export type BacktestResult = { metrics: BacktestMetrics; trades: PaperTradeClosed[] };

/** Deterministic, closed-candle backtest. It never calls exchanges or mutates live state. */
export function runBacktest(candles: Candle[], options: BacktestOptions): BacktestResult {
  if (candles.length < 2) throw new Error("Backtest requires at least two candles");
  const delay = options.executionDelayCandles ?? 0;
  if (!Number.isInteger(delay) || delay < 0) throw new Error("executionDelayCandles must be a non-negative integer");

  const trader = new PaperTrader(options);
  const closedTrades: PaperTradeClosed[] = [];
  const equities: number[] = [];
  const pending = new Map<number, boolean>();
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]!;
    const history = candles.slice(0, index + 1);
    const signal = history.length >= 50
      ? evaluateStrategy(history, options.minimumSignalScore === undefined ? undefined : { minimumScore: options.minimumSignalScore })
      : undefined;
    if (signal?.action === "BUY") pending.set(index + delay, true);
    const result = trader.processCandle(candle, pending.get(index) === true);
    pending.delete(index);
    closedTrades.push(...result.events.filter((event): event is PaperTradeClosed => event.type === "CLOSED"));
    equities.push(result.snapshot.equityUsdt);
  }

  const finalEquityUsdt = equities.at(-1)!;
  const firstPrice = candles[0]!.close;
  const buyAndHoldEquityUsdt = options.initialBalanceUsdt * candles.at(-1)!.close / firstPrice;
  const netReturnUsdt = finalEquityUsdt - options.initialBalanceUsdt;
  const grossProfitUsdt = closedTrades.filter((trade) => trade.netPnlUsdt > 0).reduce((sum, trade) => sum + trade.netPnlUsdt, 0);
  const grossLossUsdt = Math.abs(closedTrades.filter((trade) => trade.netPnlUsdt < 0).reduce((sum, trade) => sum + trade.netPnlUsdt, 0));
  let peak = options.initialBalanceUsdt;
  let maxDrawdownPercent = 0;
  for (const equity of equities) {
    peak = Math.max(peak, equity);
    maxDrawdownPercent = Math.max(maxDrawdownPercent, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }
  const wins = closedTrades.filter((trade) => trade.netPnlUsdt > 0).length;
  const losses = closedTrades.filter((trade) => trade.netPnlUsdt < 0).length;
  return { metrics: {
    initialBalanceUsdt: options.initialBalanceUsdt, finalEquityUsdt, netReturnUsdt,
    netReturnPercent: (netReturnUsdt / options.initialBalanceUsdt) * 100,
    buyAndHoldEquityUsdt, buyAndHoldReturnPercent: ((buyAndHoldEquityUsdt / options.initialBalanceUsdt) - 1) * 100,
    excessReturnVsBuyAndHoldPercent: (netReturnUsdt / options.initialBalanceUsdt) * 100 - ((buyAndHoldEquityUsdt / options.initialBalanceUsdt) - 1) * 100,
    grossProfitUsdt, grossLossUsdt, totalFeesUsdt: trader.exportState().totalFeesUsdt,
    profitFactor: grossLossUsdt === 0 ? (grossProfitUsdt > 0 ? Number.POSITIVE_INFINITY : 0) : grossProfitUsdt / grossLossUsdt,
    expectancyUsdt: closedTrades.length ? closedTrades.reduce((sum, trade) => sum + trade.netPnlUsdt, 0) / closedTrades.length : 0,
    winRate: closedTrades.length ? (wins / closedTrades.length) * 100 : 0,
    trades: closedTrades.length, wins, losses, maxDrawdownPercent, executionDelayCandles: delay,
  }, trades: closedTrades };
}
