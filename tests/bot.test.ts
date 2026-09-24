import { afterEach, describe, expect, it, vi } from "vitest";
import { TradingBot } from "../src/bot.js";
import type { PublicMarketData } from "../src/market-data.js";
import { PaperTrader } from "../src/paper-trader.js";
import type { Candle } from "../src/types.js";
import type { BotPersistence } from "../src/persistence.js";

const candle = (
  index: number,
  close = 100,
  low = close,
  high = close,
): Candle => ({
  timestamp: index * 900_000,
  open: close,
  high,
  low,
  close,
  volume: 1,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TradingBot candle replay", () => {
  it("replays every unseen candle so an intermediate stop-loss is not lost", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const firstBatch = Array.from({ length: 60 }, (_, index) =>
      candle(index),
    );
    const secondBatch = [
      ...firstBatch,
      candle(60, 100, 98, 101),
      candle(61),
    ];
    const fetchClosedCandles = vi
      .fn()
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch);
    const market = { fetchClosedCandles } as unknown as PublicMarketData;

    const paperTrader = new PaperTrader({
      initialBalanceUsdt: 1000,
      tradeSizeUsdt: 100,
      feeRate: 0.001,
      slippageRate: 0.0005,
      stopLossRate: 0.01,
      takeProfitRate: 0.02,
    });
    paperTrader.processCandle(candle(-1), true);

    const bot = new TradingBot(market, {
      symbol: "BTC/USDT",
      candleLimit: 100,
      minimumConfidence: 0.82,
      paperTrader,
    });

    await bot.runCycle();
    await bot.runCycle();

    const state = paperTrader.processCandle(candle(62), false).snapshot;
    expect(state.closedTrades).toBe(1);
    expect(state.losses).toBe(1);
    expect(state.positionQuantity).toBe(0);

    const logLines = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => String(line));
    expect(
      logLines.some(
        (line) =>
          line.includes('"event":"paper_trade_closed"') &&
          line.includes('"replayed":true'),
      ),
    ).toBe(true);
  });

  it("does not fetch market data while the persistent kill switch is paused", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchClosedCandles = vi.fn();
    const persistence = {
      isPaused: vi.fn(async () => true),
    } as unknown as BotPersistence;
    const bot = new TradingBot(
      { fetchClosedCandles } as unknown as PublicMarketData,
      {
        symbol: "BTC/USDT",
        candleLimit: 100,
        minimumConfidence: 0.82,
        paperTrader: new PaperTrader({
          initialBalanceUsdt: 1000,
          tradeSizeUsdt: 100,
          feeRate: 0.001,
          slippageRate: 0.0005,
          stopLossRate: 0.01,
          takeProfitRate: 0.02,
        }),
        persistence,
      },
    );

    await bot.runCycle();

    expect(fetchClosedCandles).not.toHaveBeenCalled();
  });

  it("rolls back paper state and retries safely when persistence fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const candles = Array.from({ length: 60 }, (_, index) => candle(index));
    const market = {
      fetchClosedCandles: vi.fn(async () => candles),
    } as unknown as PublicMarketData;
    const recordCycle = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(undefined);
    const persistence = {
      isPaused: vi.fn(async () => false),
      recordCycle,
    } as unknown as BotPersistence;
    const paperTrader = new PaperTrader({
      initialBalanceUsdt: 1000,
      tradeSizeUsdt: 100,
      feeRate: 0.001,
      slippageRate: 0.0005,
      stopLossRate: 0.01,
      takeProfitRate: 0.02,
    });
    const initialState = paperTrader.exportState();
    const bot = new TradingBot(market, {
      symbol: "BTC/USDT",
      candleLimit: 100,
      minimumConfidence: 0.82,
      paperTrader,
      persistence,
    });

    await expect(bot.runCycle()).rejects.toThrow("database unavailable");
    expect(paperTrader.exportState()).toEqual(initialState);

    await expect(bot.runCycle()).resolves.toBeUndefined();
    expect(recordCycle).toHaveBeenCalledTimes(2);
  });
});
