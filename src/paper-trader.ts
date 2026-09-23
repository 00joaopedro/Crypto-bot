import type { Candle } from "./types.js";

export type PaperTraderOptions = {
  initialBalanceUsdt: number;
  tradeSizeUsdt: number;
  feeRate: number;
  slippageRate: number;
  stopLossRate: number;
  takeProfitRate: number;
};

type Position = {
  entryTimestamp: number;
  entryPrice: number;
  quantity: number;
  entryNotional: number;
  entryFee: number;
  stopLossPrice: number;
  takeProfitPrice: number;
};

export type PaperTradeOpened = {
  type: "OPENED";
  timestamp: number;
  entryPrice: number;
  quantity: number;
  notionalUsdt: number;
  feeUsdt: number;
  stopLossPrice: number;
  takeProfitPrice: number;
};

export type PaperTradeClosed = {
  type: "CLOSED";
  entryTimestamp: number;
  exitTimestamp: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  reason: "STOP_LOSS" | "TAKE_PROFIT";
  grossProceedsUsdt: number;
  feesUsdt: number;
  netPnlUsdt: number;
  netPnlPercent: number;
};

export type PortfolioSnapshot = {
  timestamp: number;
  cashUsdt: number;
  positionQuantity: number;
  positionMarketValueUsdt: number;
  equityUsdt: number;
  realizedPnlUsdt: number;
  unrealizedPnlUsdt: number;
  totalFeesUsdt: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  peakEquityUsdt: number;
  currentDrawdownPercent: number;
  maxDrawdownPercent: number;
  buyAndHoldEquityUsdt: number;
  buyAndHoldReturnPercent: number;
  strategyReturnPercent: number;
  excessReturnVsBuyAndHoldPercent: number;
};

export type PaperCycleResult = {
  events: Array<PaperTradeOpened | PaperTradeClosed>;
  snapshot: PortfolioSnapshot;
};

export class PaperTrader {
  private cashUsdt: number;
  private position: Position | undefined;
  private realizedPnlUsdt = 0;
  private totalFeesUsdt = 0;
  private closedTrades = 0;
  private wins = 0;
  private losses = 0;
  private peakEquityUsdt: number;
  private maxDrawdownPercent = 0;
  private benchmarkStartPrice: number | undefined;

  constructor(private readonly options: PaperTraderOptions) {
    assertPositive(options.initialBalanceUsdt, "initialBalanceUsdt");
    assertPositive(options.tradeSizeUsdt, "tradeSizeUsdt");
    assertRate(options.feeRate, "feeRate");
    assertRate(options.slippageRate, "slippageRate");
    assertRate(options.stopLossRate, "stopLossRate");
    assertRate(options.takeProfitRate, "takeProfitRate");

    this.cashUsdt = options.initialBalanceUsdt;
    this.peakEquityUsdt = options.initialBalanceUsdt;
  }

  processCandle(candle: Candle, buyApproved: boolean): PaperCycleResult {
    this.benchmarkStartPrice ??= candle.close;
    const events: Array<PaperTradeOpened | PaperTradeClosed> = [];
    const closedThisCandle = this.tryClosePosition(candle);

    if (closedThisCandle) {
      events.push(closedThisCandle);
    } else if (!this.position && buyApproved) {
      const opened = this.tryOpenPosition(candle);
      if (opened) events.push(opened);
    }

    return {
      events,
      snapshot: this.createSnapshot(candle),
    };
  }

  private tryOpenPosition(candle: Candle): PaperTradeOpened | undefined {
    const affordableNotional = this.cashUsdt / (1 + this.options.feeRate);
    const entryNotional = Math.min(this.options.tradeSizeUsdt, affordableNotional);
    if (entryNotional <= 0) return undefined;

    const entryPrice = candle.close * (1 + this.options.slippageRate);
    const quantity = entryNotional / entryPrice;
    const entryFee = entryNotional * this.options.feeRate;
    const position: Position = {
      entryTimestamp: candle.timestamp,
      entryPrice,
      quantity,
      entryNotional,
      entryFee,
      stopLossPrice: entryPrice * (1 - this.options.stopLossRate),
      takeProfitPrice: entryPrice * (1 + this.options.takeProfitRate),
    };

    this.cashUsdt -= entryNotional + entryFee;
    this.totalFeesUsdt += entryFee;
    this.position = position;

    return {
      type: "OPENED",
      timestamp: candle.timestamp,
      entryPrice,
      quantity,
      notionalUsdt: entryNotional,
      feeUsdt: entryFee,
      stopLossPrice: position.stopLossPrice,
      takeProfitPrice: position.takeProfitPrice,
    };
  }

  private tryClosePosition(candle: Candle): PaperTradeClosed | undefined {
    const position = this.position;
    if (!position || candle.timestamp <= position.entryTimestamp) return undefined;

    const stopTouched = candle.low <= position.stopLossPrice;
    const takeProfitTouched = candle.high >= position.takeProfitPrice;
    if (!stopTouched && !takeProfitTouched) return undefined;

    // With OHLC data the intrabar order is unknown. If both levels were touched,
    // choose stop-loss first to keep the simulation conservative.
    const reason = stopTouched ? "STOP_LOSS" : "TAKE_PROFIT";
    const targetPrice =
      reason === "STOP_LOSS" ? position.stopLossPrice : position.takeProfitPrice;
    const exitPrice = targetPrice * (1 - this.options.slippageRate);
    const grossProceeds = position.quantity * exitPrice;
    const exitFee = grossProceeds * this.options.feeRate;
    const netProceeds = grossProceeds - exitFee;
    const netPnl =
      netProceeds - position.entryNotional - position.entryFee;

    this.cashUsdt += netProceeds;
    this.realizedPnlUsdt += netPnl;
    this.totalFeesUsdt += exitFee;
    this.closedTrades += 1;
    if (netPnl > 0) this.wins += 1;
    else this.losses += 1;
    this.position = undefined;

    return {
      type: "CLOSED",
      entryTimestamp: position.entryTimestamp,
      exitTimestamp: candle.timestamp,
      entryPrice: position.entryPrice,
      exitPrice,
      quantity: position.quantity,
      reason,
      grossProceedsUsdt: grossProceeds,
      feesUsdt: position.entryFee + exitFee,
      netPnlUsdt: netPnl,
      netPnlPercent:
        (netPnl / (position.entryNotional + position.entryFee)) * 100,
    };
  }

  private createSnapshot(candle: Candle): PortfolioSnapshot {
    const positionMarketValue = this.position
      ? this.position.quantity * candle.close
      : 0;
    const estimatedExitFee = positionMarketValue * this.options.feeRate;
    const equity = this.cashUsdt + positionMarketValue - estimatedExitFee;
    const unrealizedPnl = this.position
      ? positionMarketValue -
        estimatedExitFee -
        this.position.entryNotional -
        this.position.entryFee
      : 0;

    this.peakEquityUsdt = Math.max(this.peakEquityUsdt, equity);
    const currentDrawdown =
      this.peakEquityUsdt === 0
        ? 0
        : ((this.peakEquityUsdt - equity) / this.peakEquityUsdt) * 100;
    this.maxDrawdownPercent = Math.max(
      this.maxDrawdownPercent,
      currentDrawdown,
    );

    const benchmarkStartPrice = this.benchmarkStartPrice ?? candle.close;
    const buyAndHoldEquity =
      this.options.initialBalanceUsdt * (candle.close / benchmarkStartPrice);
    const buyAndHoldReturn =
      ((buyAndHoldEquity / this.options.initialBalanceUsdt) - 1) * 100;
    const strategyReturn =
      ((equity / this.options.initialBalanceUsdt) - 1) * 100;

    return {
      timestamp: candle.timestamp,
      cashUsdt: round(this.cashUsdt),
      positionQuantity: this.position?.quantity ?? 0,
      positionMarketValueUsdt: round(positionMarketValue),
      equityUsdt: round(equity),
      realizedPnlUsdt: round(this.realizedPnlUsdt),
      unrealizedPnlUsdt: round(unrealizedPnl),
      totalFeesUsdt: round(this.totalFeesUsdt),
      closedTrades: this.closedTrades,
      wins: this.wins,
      losses: this.losses,
      winRate:
        this.closedTrades === 0
          ? 0
          : round((this.wins / this.closedTrades) * 100),
      peakEquityUsdt: round(this.peakEquityUsdt),
      currentDrawdownPercent: round(currentDrawdown),
      maxDrawdownPercent: round(this.maxDrawdownPercent),
      buyAndHoldEquityUsdt: round(buyAndHoldEquity),
      buyAndHoldReturnPercent: round(buyAndHoldReturn),
      strategyReturnPercent: round(strategyReturn),
      excessReturnVsBuyAndHoldPercent: round(
        strategyReturn - buyAndHoldReturn,
      ),
    };
  }
}

function assertPositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive finite number`);
  }
}

function assertRate(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error(`${field} must be between 0 (inclusive) and 1 (exclusive)`);
  }
}

function round(value: number): number {
  return Number(value.toFixed(8));
}
