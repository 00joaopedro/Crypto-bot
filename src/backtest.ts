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
  /** Number of leading candles used only to warm indicators/state. */
  warmupCandles?: number;
  qualityFilters?: boolean;
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
  const warmup = options.warmupCandles ?? 0;
  if (!Number.isInteger(warmup) || warmup < 0 || warmup >= candles.length - 1) throw new Error("warmupCandles must leave at least two test candles");
  if (!Number.isInteger(delay) || delay < 0) throw new Error("executionDelayCandles must be a non-negative integer");

  const trader = new PaperTrader(options);
  const closedTrades: PaperTradeClosed[] = [];
  const equities: number[] = [];
  const pending = new Map<number, boolean>();
  const filtersEnabled = options.qualityFilters === true;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]!;
    const signal = index >= (filtersEnabled ? 84 : 50) ? evaluateStrategy(candles.slice(0, index + 1), {
      ...(options.minimumSignalScore === undefined ? {} : { minimumScore: options.minimumSignalScore }),
      ...(options.qualityFilters === undefined ? {} : { qualityFilters: options.qualityFilters }),
    }) : undefined;
    // A signal uses the just-closed candle; the earliest honest fill is the
    // next candle, even when no additional artificial delay is requested.
    if (signal?.action === "BUY") pending.set(index + Math.max(1, delay), true);
    const sellSignal = signal?.action === "SELL";
    const result = trader.processCandle(candle, pending.get(index) === true, undefined, sellSignal);
    pending.delete(index);
    if (index >= warmup) {
      closedTrades.push(...result.events.filter((event): event is PaperTradeClosed => event.type === "CLOSED"));
      equities.push(result.snapshot.equityUsdt);
    }
  }

  const finalEquityUsdt = equities.at(-1)!;
  const baselineEquity = warmup > 0 ? equities[0]! : options.initialBalanceUsdt;
  const firstPrice = candles[warmup]!.close;
  const buyAndHoldEquityUsdt = baselineEquity * candles.at(-1)!.close / firstPrice;
  const netReturnUsdt = finalEquityUsdt - baselineEquity;
  const grossProfitUsdt = closedTrades.filter((trade) => trade.netPnlUsdt > 0).reduce((sum, trade) => sum + trade.netPnlUsdt, 0);
  const grossLossUsdt = Math.abs(closedTrades.filter((trade) => trade.netPnlUsdt < 0).reduce((sum, trade) => sum + trade.netPnlUsdt, 0));
  let peak = baselineEquity;
  let maxDrawdownPercent = 0;
  for (const equity of equities) {
    peak = Math.max(peak, equity);
    maxDrawdownPercent = Math.max(maxDrawdownPercent, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }
  const wins = closedTrades.filter((trade) => trade.netPnlUsdt > 0).length;
  const losses = closedTrades.filter((trade) => trade.netPnlUsdt < 0).length;
  return { metrics: {
    initialBalanceUsdt: baselineEquity, finalEquityUsdt, netReturnUsdt,
    netReturnPercent: (netReturnUsdt / baselineEquity) * 100,
    buyAndHoldEquityUsdt, buyAndHoldReturnPercent: ((buyAndHoldEquityUsdt / baselineEquity) - 1) * 100,
    excessReturnVsBuyAndHoldPercent: (netReturnUsdt / baselineEquity) * 100 - ((buyAndHoldEquityUsdt / baselineEquity) - 1) * 100,
    grossProfitUsdt, grossLossUsdt, totalFeesUsdt: trader.exportState().totalFeesUsdt,
    profitFactor: grossLossUsdt === 0 ? (grossProfitUsdt > 0 ? Number.POSITIVE_INFINITY : 0) : grossProfitUsdt / grossLossUsdt,
    expectancyUsdt: closedTrades.length ? closedTrades.reduce((sum, trade) => sum + trade.netPnlUsdt, 0) / closedTrades.length : 0,
    winRate: closedTrades.length ? (wins / closedTrades.length) * 100 : 0,
    trades: closedTrades.length, wins, losses, maxDrawdownPercent, executionDelayCandles: delay,
  }, trades: closedTrades };
}

export function compareSignalQuality(candles: Candle[], options: BacktestOptions): { withFilters: BacktestResult; withoutFilters: BacktestResult } {
  return {
    withFilters: runBacktest(candles, { ...options, qualityFilters: true }),
    withoutFilters: runBacktest(candles, { ...options, qualityFilters: false }),
  };
}
