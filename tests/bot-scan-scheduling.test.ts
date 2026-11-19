import { afterEach, describe, expect, it, vi } from "vitest";
import { TradingBot } from "../src/bot.js";
import type { PublicMarketData } from "../src/market-data.js";
import { PaperTrader } from "../src/paper-trader.js";
import { CentralTradeManager } from "../src/trade-manager.js";
import { evaluateStrategy } from "../src/strategy.js";
import { exitPolicySchema } from "../src/exit-policy.js";
import { rankSignals } from "../src/signal-ranking.js";

vi.mock("../src/strategy.js", () => ({ evaluateStrategy: vi.fn(() => ({ action: "HOLD", score: 0 })) }));
vi.mock("../src/signal-ranking.js", () => ({ rankSignals: vi.fn((candidates: Array<{ symbol: string }>) => candidates.map(({ symbol }, i) => ({ symbol, eligible: false, rank: i + 1, signal: { action: "HOLD", score: 0 } }))) }));
afterEach(() => vi.restoreAllMocks());

function setup({ size = 100, budget = 20, concurrency = 2, open = false, principalOpen = false, stopHit = true, timeBudget = 10000 } = {}) {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  let end = 85;
  const candles = () => Array.from({ length: end }, (_, i) => ({ timestamp: i * 900000, open: 100, high: 100.01, low: i === 84 && stopHit && (open || principalOpen) ? 80 : 99.99, close: 100, volume: 1 }));
  const symbols = Array.from({ length: 200 }, (_, i) => `C${String(i).padStart(3, "0")}/USDT`);
  const events: string[] = [];
  let active = 0, peak = 0;
  const fetchScanCandles = vi.fn(async (symbol: string) => {
    events.push(`scan:${symbol}`);
    active++; peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return candles();
  });
  const fetchClosedCandles = vi.fn(async (symbol: string) => {
    events.push(`manage:${symbol}`);
    return candles();
  });
  const screenSpotSymbols = vi.fn(async () => ({ eligible: ["BTC/USDT", ...symbols], blocked: {} }));
  const manager = new CentralTradeManager({ maxConcurrentPositions: 10, maxExposurePercent: 1 });
  const paper = new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 10, feeRate: .001, slippageRate: 0, stopLossRate: .1, takeProfitRate: .2 });
  if (principalOpen) {
    paper.processCandle(candles()[83]!, true);
    manager.recordEntry({ symbol: "BTC/USDT", openedAt: candles()[83]!.timestamp, notionalUsdt: 10 });
  }
  const other = new PaperTrader(paper.configuration);
  if (open) {
    other.processCandle(candles()[83]!, true);
    manager.recordEntry({ symbol: "OLD/USDT", openedAt: candles()[83]!.timestamp, notionalUsdt: 10 });
  }
  const recordCycle = vi.fn();
  const market = { active: "okx", fetchClosedCandles, fetchScanCandles, screenSpotSymbols } as unknown as PublicMarketData;
  const options = {
    symbol: "BTC/USDT", candleLimit: 85, minimumConfidence: .8, paperTrader: paper, dynamicUniverseSize: size,
    scanRequestBudget: budget, scanConcurrency: concurrency, scanTimeBudgetMs: timeBudget,
    tradeManager: manager,
    persistence: {
      isPaused: async () => false, recordCycle,
      loadRecoveryState: async (symbol: string) => symbol === "OLD/USDT" && open
        ? { symbol, paperState: other.exportState(), lastProcessedCandle: candles()[83]!.timestamp } : null,
    },
  };
  const bot = new TradingBot(market, options as unknown as ConstructorParameters<typeof TradingBot>[1]);
  return { bot, options, market, paper, manager, events, recordCycle, fetchScanCandles, screenSpotSymbols,
    nextCandle: () => end++, peak: () => peak, symbols };
}

// Keep the fixture's concurrency observation explicit without timer sleeps.
describe("bounded broad market scan", () => {
  it("finishes 100 candidates progressively without exceeding concurrency or repeating cached requests", async () => {
    const f = setup();
    vi.mocked(rankSignals).mockClear();
    await f.bot.runCycle();
    expect(f.fetchScanCandles).toHaveBeenCalledTimes(20);
    expect(f.peak()).toBe(2);
    expect(f.bot.getLastSignalScan()?.statistics).toMatchObject({ targetCandidates: 100, analyzedCandidates: 21, pendingCandidates: 79 });
    for (let i = 0; i < 4; i++) await f.bot.runCycle();
    expect(f.fetchScanCandles).toHaveBeenCalledTimes(99);
    expect(f.bot.getLastSignalScan()?.pairs).toHaveLength(100);
    const ranks = vi.mocked(rankSignals).mock.calls.length;
    await f.bot.runCycle();
    expect(f.fetchScanCandles).toHaveBeenCalledTimes(99);
    expect(vi.mocked(rankSignals).mock.calls).toHaveLength(ranks);
    expect(f.screenSpotSymbols).toHaveBeenCalledTimes(1);
    expect(f.bot.getLastSignalScan()?.statistics).toMatchObject({ candleRequests: 0, cacheHits: 99, pendingCandidates: 0 });
    const rankingLogs = vi.mocked(console.log).mock.calls.map(([line]) => JSON.parse(String(line))).filter(line => line.event === "signal_ranking");
    expect(rankingLogs.at(-1)).toMatchObject({ candidateCount: 100 });
    expect(rankingLogs.at(-1).candidates).toHaveLength(20);
  });

  it("supports 200 or all eligible markets without scheduling an unbounded batch", async () => {
    const limited = setup({ size: 200, budget: 7 });
    await limited.bot.runCycle();
    expect(limited.bot.getLastSignalScan()?.statistics).toMatchObject({ targetCandidates: 200, candleRequests: 7 });
    const all = setup({ size: 0, budget: 7 });
    await all.bot.runCycle();
    expect(all.bot.getLastSignalScan()?.statistics).toMatchObject({ eligibleMarkets: 201, targetCandidates: 201, analyzedCandidates: 8, candleRequests: 7 });
  });

  it("carries the cursor to the next candle, clearing old data and avoiding starvation", async () => {
    const f = setup({ size: 200, budget: 10 });
    await f.bot.runCycle();
    const previous = new Set(f.fetchScanCandles.mock.calls.map(([symbol]) => symbol));
    f.nextCandle();
    await f.bot.runCycle();
    const later = f.fetchScanCandles.mock.calls.slice(10).map(([symbol]) => symbol);
    expect(later.every(symbol => !previous.has(symbol))).toBe(true);
    expect(f.screenSpotSymbols).toHaveBeenCalledTimes(2);
    expect(f.bot.getLastSignalScan()?.statistics).toMatchObject({ analyzedCandidates: 11, candleRequests: 10 });
  });

  it("rebuilds the candle cache on provider changes and anchors every concurrent request", async () => {
    const f = setup({ size: 5 });
    await f.bot.runCycle();
    expect(f.fetchScanCandles.mock.calls.every(call => (call as unknown[])[2] === "okx")).toBe(true);
    Object.assign(f.market, { active: "kraken" });
    await f.bot.runCycle();
    expect(f.fetchScanCandles).toHaveBeenCalledTimes(8);
    expect(f.fetchScanCandles.mock.calls.slice(4).every(call => (call as unknown[])[2] === "kraken")).toBe(true);
  });

  it("isolates failures, processes other candidates and retries failed requests later", async () => {
    const f = setup({ size: 5, budget: 20 });
    f.fetchScanCandles.mockRejectedValueOnce(new Error("429 rate limited"));
    await f.bot.runCycle();
    expect(f.bot.getLastSignalScan()?.statistics).toMatchObject({ analyzedCandidates: 4, pendingCandidates: 1, failedRequests: 1 });
    await f.bot.runCycle();
    expect(f.fetchScanCandles).toHaveBeenCalledTimes(5);
    expect(f.bot.getLastSignalScan()?.statistics).toMatchObject({ analyzedCandidates: 5, pendingCandidates: 0, failedRequests: 0 });
  });

  it("does not cache a late candle as analyzed and retries it when available", async () => {
    const f = setup({ size: 2 });
    f.fetchScanCandles.mockResolvedValueOnce([]);
    await f.bot.runCycle();
    expect(f.bot.getLastSignalScan()?.statistics).toMatchObject({ analyzedCandidates: 1, pendingCandidates: 1 });
    await f.bot.runCycle();
    expect(f.bot.getLastSignalScan()?.statistics).toMatchObject({ analyzedCandidates: 2, pendingCandidates: 0 });
  });

  it("stops scheduling when the time allowance is consumed and awaits in-flight work", async () => {
    const f = setup({ size: 100, concurrency: 1, budget: 20 });
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const original = f.fetchScanCandles.getMockImplementation()!;
    f.fetchScanCandles.mockImplementation(async symbol => {
      clock += 6000;
      return original(symbol);
    });
    await f.bot.runCycle();
    expect(f.fetchScanCandles).toHaveBeenCalledTimes(2);
    expect(f.peak()).toBe(1);
    expect(f.bot.getLastSignalScan()?.statistics).toMatchObject({ durationMs: 12000, timeBudgetMs: 10000, pendingCandidates: 97 });
  });

  it.each([false, true])("supervises open Paper stops before broad discovery (principal=%s)", async principalOpen => {
    const f = setup({ open: !principalOpen, principalOpen });
    const original = f.screenSpotSymbols.getMockImplementation()!;
    f.screenSpotSymbols.mockImplementation(async () => {
      expect(f.manager.activePositions).toHaveLength(0);
      expect(f.recordCycle).toHaveBeenCalledWith(expect.objectContaining({
        symbol: principalOpen ? "BTC/USDT" : "OLD/USDT",
        paperResult: expect.objectContaining({ events: [expect.objectContaining({ type: "CLOSED" })] }),
      }));
      return original();
    });
    await f.bot.runCycle();
    expect(f.fetchScanCandles).toHaveBeenCalledTimes(20);
  });
});


it("does not start broad discovery if an exit cannot be persisted", async () => {
  const f = setup({ principalOpen: true });
  f.recordCycle.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(f.bot.runCycle()).rejects.toThrow("database unavailable");
  expect(f.paper.hasOpenPosition).toBe(true);
  expect(f.screenSpotSymbols).not.toHaveBeenCalled();
  expect(f.fetchScanCandles).not.toHaveBeenCalled();
});

it("respects a loss latch raised by priority supervision before new scans", async () => {
  const f = setup({ principalOpen: true });
  const bot = new TradingBot(f.market, { ...f.options, maxConsecutiveLosses: 1 } as unknown as ConstructorParameters<typeof TradingBot>[1]);
  await bot.runCycle();
  expect(f.paper.hasOpenPosition).toBe(false);
  expect(f.recordCycle).toHaveBeenCalledWith(expect.objectContaining({ lossPause: expect.any(Object) }));
  expect(f.screenSpotSymbols).not.toHaveBeenCalled();
  expect(f.fetchScanCandles).not.toHaveBeenCalled();
});


it("preserves a live contrary-signal Demo sell when its Paper exit is supervised first", async () => {
  const f = setup({ principalOpen: true, stopHit: false });
  const executeApprovedSell = vi.fn(async () => ({ status: "PLACED", orderId: "1", clientOrderId: "C1" }));
  vi.mocked(evaluateStrategy).mockReturnValueOnce({ action: "SELL", score: 8 } as ReturnType<typeof evaluateStrategy>);
  const bot = new TradingBot(f.market, {
    ...f.options,
    demoExecutor: { executeApprovedBuy: vi.fn(), executeApprovedSell },
    persistence: { ...f.options.persistence, recordDemoOrder: vi.fn() },
  } as unknown as ConstructorParameters<typeof TradingBot>[1]);
  await bot.runCycle();
  expect(f.paper.hasOpenPosition).toBe(false);
  expect(executeApprovedSell).toHaveBeenCalledOnce();
  await bot.runCycle();
  expect(executeApprovedSell).toHaveBeenCalledOnce();
});

it("does not turn a historical contrary-signal close into a live Demo sell", async () => {
  const f = setup({ principalOpen: true, stopHit: false });
  f.nextCandle();
  const executeApprovedSell = vi.fn();
  vi.mocked(evaluateStrategy).mockReturnValueOnce({ action: "SELL", score: 8 } as ReturnType<typeof evaluateStrategy>);
  const bot = new TradingBot(f.market, {
    ...f.options, demoExecutor: { executeApprovedBuy: vi.fn(), executeApprovedSell },
  } as unknown as ConstructorParameters<typeof TradingBot>[1]);
  await bot.runCycle();
  expect(f.paper.hasOpenPosition).toBe(false);
  expect(executeApprovedSell).not.toHaveBeenCalled();
});

it("does not reprocess a supervised candle against a trailing level raised by that same candle", async () => {
  const f = setup({ principalOpen: true, stopHit: false });
  const fetch = vi.mocked(f.market.fetchClosedCandles);
  const original = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (...args) => (await original(...args)).map((c, i) => i === 84 ? { ...c, close: 101.4, high: 101.5 } : c));
  const paper = new PaperTrader({ ...f.paper.configuration, exitPolicy: exitPolicySchema.parse({ mode: "trailing_atr", activationRate: .005 }) });
  paper.processCandle((await f.market.fetchClosedCandles("BTC/USDT", 85))[83]!, true);
  const bot = new TradingBot(f.market, { ...f.options, paperTrader: paper } as unknown as ConstructorParameters<typeof TradingBot>[1]);
  await bot.runCycle();
  expect(paper.exportState().position?.stopLossPrice).toBeGreaterThan(100);
  expect(paper.hasOpenPosition).toBe(true);
  await bot.runCycle();
  expect(paper.hasOpenPosition).toBe(true);
  expect(paper.exportState().closedTrades).toBe(0);
});
