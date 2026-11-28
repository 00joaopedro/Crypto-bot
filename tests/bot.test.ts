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


it('recovers a distant Paper history gap before replay and never fabricates a new entry in recovered candles', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const full = Array.from({ length: 400 }, (_, i) => candle(i, 100, i === 100 ? 80 : 99, 101));
  const paper = new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 10, feeRate: .001, slippageRate: 0, stopLossRate: .1, takeProfitRate: .2 });
  paper.processCandle(full[83]!, true);
  const recordCycle = vi.fn(async () => undefined);
  const recordOperationalEvent = vi.fn(async () => undefined);
  const fetchRecoveryCandles = vi.fn(async () => full);
  const market = { active: 'okx', fetchClosedCandles: async () => full.slice(-100), fetchRecoveryCandles } as unknown as PublicMarketData;
  const persistence = { isPaused: async () => false, recordCycle, recordOperationalEvent } as unknown as BotPersistence;
  try {
    const executeApprovedBuy = vi.fn();
    const bot = new TradingBot(market, { demoExecutor: { executeApprovedBuy } as never, symbol: 'BTC/USDT', candleLimit: 100, minimumConfidence: .8,
      aiFailureMode: 'quantitative', paperTrader: paper, persistence, initialLastProcessedCandle: full[83]!.timestamp });
    await bot.reconcilePaperOnly();
    expect(executeApprovedBuy).not.toHaveBeenCalled();
    expect(fetchRecoveryCandles).toHaveBeenCalledWith('BTC/USDT',full[83]!.timestamp,full[399]!.timestamp);
    const cycles = recordCycle.mock.calls.map(call => (call as unknown as [ { candle: Candle; paperResult: { events: Array<{ type: string }> } } ])[0]);
    expect(cycles.some(c => c.candle.timestamp === full[100]!.timestamp && c.paperResult.events.some(e => e.type === 'CLOSED'))).toBe(true);
    expect(cycles.filter(c => c.candle.timestamp < full[399]!.timestamp).every(c => c.paperResult.events.every(e => e.type !== 'OPENED'))).toBe(true);
    expect(recordOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'PAPER_HISTORY_RECOVERED' }));
  } finally { vi.restoreAllMocks(); }
});
