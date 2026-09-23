import { describe, expect, it } from "vitest";
import { PaperTrader, type PaperTraderOptions } from "../src/paper-trader.js";
import type { Candle } from "../src/types.js";

const options: PaperTraderOptions = {
  initialBalanceUsdt: 1000,
  tradeSizeUsdt: 100,
  feeRate: 0.001,
  slippageRate: 0.0005,
  stopLossRate: 0.01,
  takeProfitRate: 0.02,
};

const candle = (
  timestamp: number,
  close: number,
  low = close,
  high = close,
  open = close,
): Candle => ({
  timestamp,
  open,
  high,
  low,
  close,
  volume: 1,
});

describe("PaperTrader", () => {
  it("opens an approved trade and closes it at take-profit with fees and slippage", () => {
    const trader = new PaperTrader(options);

    const opened = trader.processCandle(candle(1, 100), true);
    expect(opened.events).toHaveLength(1);
    expect(opened.events[0]?.type).toBe("OPENED");
    expect(opened.snapshot.positionQuantity).toBeGreaterThan(0);
    expect(opened.snapshot.totalFeesUsdt).toBeCloseTo(0.1);

    const closed = trader.processCandle(candle(2, 102, 101, 103), false);
    expect(closed.events).toHaveLength(1);
    expect(closed.events[0]).toMatchObject({
      type: "CLOSED",
      reason: "TAKE_PROFIT",
    });
    expect(closed.snapshot.closedTrades).toBe(1);
    expect(closed.snapshot.wins).toBe(1);
    expect(closed.snapshot.realizedPnlUsdt).toBeGreaterThan(0);
    expect(closed.snapshot.totalFeesUsdt).toBeGreaterThan(0.1);
  });

  it("uses stop-loss conservatively when stop and take-profit are touched in one candle", () => {
    const trader = new PaperTrader(options);
    trader.processCandle(candle(1, 100), true);

    const closed = trader.processCandle(candle(2, 100, 98, 103), false);
    expect(closed.events[0]).toMatchObject({
      type: "CLOSED",
      reason: "STOP_LOSS",
    });
    expect(closed.snapshot.losses).toBe(1);
    expect(closed.snapshot.realizedPnlUsdt).toBeLessThan(0);
    expect(closed.snapshot.maxDrawdownPercent).toBeGreaterThan(0);
  });

  it("fills a stop-loss gap from the lower candle open before slippage", () => {
    const trader = new PaperTrader(options);
    const opened = trader.processCandle(candle(1, 100), true);
    const openEvent = opened.events[0];
    if (!openEvent || openEvent.type !== "OPENED") {
      throw new Error("Expected the paper position to open");
    }

    const gapOpen = 95;
    const closed = trader.processCandle(
      candle(2, 96, 94, 97, gapOpen),
      false,
    );
    const closeEvent = closed.events[0];
    if (!closeEvent || closeEvent.type !== "CLOSED") {
      throw new Error("Expected the paper position to close");
    }

    expect(closeEvent.reason).toBe("STOP_LOSS");
    expect(closeEvent.exitPrice).toBeCloseTo(
      gapOpen * (1 - options.slippageRate),
    );
    expect(closeEvent.exitPrice).toBeLessThan(openEvent.stopLossPrice);
  });

  it("tracks buy-and-hold independently from the strategy portfolio", () => {
    const trader = new PaperTrader(options);

    const initial = trader.processCandle(candle(1, 100), false);
    const later = trader.processCandle(candle(2, 110), false);

    expect(initial.snapshot.buyAndHoldEquityUsdt).toBe(1000);
    expect(later.snapshot.buyAndHoldEquityUsdt).toBe(1100);
    expect(later.snapshot.buyAndHoldReturnPercent).toBe(10);
    expect(later.snapshot.strategyReturnPercent).toBe(0);
    expect(later.snapshot.excessReturnVsBuyAndHoldPercent).toBe(-10);
  });

  it("does not re-enter on the same candle that closes a position", () => {
    const trader = new PaperTrader(options);
    trader.processCandle(candle(1, 100), true);

    const result = trader.processCandle(candle(2, 102, 101, 103), true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe("CLOSED");
    expect(result.snapshot.positionQuantity).toBe(0);
  });
});
