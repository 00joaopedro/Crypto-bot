import { expect, it, vi } from 'vitest';
import { evaluateStrategy } from '../src/strategy.js';
import { TradingBot } from '../src/bot.js';
import { PaperTrader } from '../src/paper-trader.js';
import { CentralTradeManager } from '../src/trade-manager.js';
import type { PublicMarketData } from '../src/market-data.js';
import type { BotPersistence } from '../src/persistence.js';
import type { OkxDemoExecutor } from '../src/okx-demo.js';
vi.mock('../src/strategy.js', () => ({ evaluateStrategy: vi.fn(() => ({ action: 'BUY', score: 8 })) }));
vi.mock('../src/signal-ranking.js', () => ({ rankSignals: () => [{ symbol: 'ETH/USDT', eligible: true, rank: 1, signal: { action: 'BUY', score: 8 } }] }));
it('selects the Demo candidate while monitoring a Paper position in a paused pair', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const candles = Array.from({ length: 85 }, (_, i) => ({ timestamp: i * 900000, open: 100, high: 100.01, low: 99.99, close: 100, volume: 1 }));
  const paper = new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0, slippageRate: 0, stopLossRate: 0.1, takeProfitRate: 0.2 });
  paper.processCandle(candles[83]!, true);
  const manager = new CentralTradeManager({ maxConcurrentPositions: 3, maxExposurePercent: 1 });
  manager.recordEntry({ symbol: 'BTC/USDT', openedAt: candles[83]!.timestamp, notionalUsdt: 100 });
  const executeApprovedBuy = vi.fn(async () => ({ status: 'PLACED' as const, orderId: '1', clientOrderId: 'CB1' }));
  const recordCycle = vi.fn();
  const bot = new TradingBot({ fetchClosedCandles: async () => candles } as unknown as PublicMarketData, {
    symbol: 'BTC/USDT', candleLimit: 85, minimumConfidence: 0.8, minimumSignalScore: 4, aiFailureMode: 'quantitative', paperTrader: paper,
    tradeManager: manager, signalScanSymbols: ['ETH/USDT'], inspectDemoEntry: async () => ({ allowed: true }),
    demoExecutor: { executeApprovedBuy } as unknown as OkxDemoExecutor,
    pairCooldown: { hours: 6, minLosses: 3 },
    persistence: { activePairCooldowns: async () => [{ symbol: 'BTC/USDT', until: Date.now() + 1e6 }], isPaused: async () => false, recordCycle, recordDemoOrder: async () => undefined } as unknown as BotPersistence,
  });
  await bot.runCycle();
  expect(executeApprovedBuy).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ETH/USDT' }));
  expect(recordCycle).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTC/USDT', replayed: true }));
  expect(evaluateStrategy).toHaveBeenCalledWith(expect.any(Array), { minimumScore: 4 });
  log.mockRestore();
});
it('persists monitored Paper loss controls in the same cycle as its exit', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const candles = Array.from({ length: 85 }, (_, i) => ({ timestamp: i * 900000, open: 100, high: 100.01, low: 99.99, close: 100, volume: 1 }));
  const paper = new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0, slippageRate: 0, stopLossRate: 0.1, takeProfitRate: 0.2 });
  paper.processCandle(candles[83]!, true);
  const manager = new CentralTradeManager({ maxConcurrentPositions: 3, maxExposurePercent: 1 });
  manager.recordEntry({ symbol: 'BTC/USDT', openedAt: candles[83]!.timestamp, notionalUsdt: 100 });
  const executeApprovedBuy = vi.fn(async () => ({ status: 'PLACED' as const, orderId: '1', clientOrderId: 'CB1' }));
  const recordCycle = vi.fn();
  const bot = new TradingBot({ fetchClosedCandles: async (symbol: string) => symbol === 'BTC/USDT' ? candles.map((c, i) => i === 84 ? { ...c, low: 80, close: 80 } : c) : candles } as unknown as PublicMarketData, {
    symbol: 'BTC/USDT', candleLimit: 85, minimumConfidence: 0.8, minimumSignalScore: 4, aiFailureMode: 'quantitative', paperTrader: paper,
    tradeManager: manager, signalScanSymbols: ['ETH/USDT'], inspectDemoEntry: async () => ({ allowed: true }),
    demoExecutor: { executeApprovedBuy } as unknown as OkxDemoExecutor,
    persistence: { isPaused: async () => false, recordCycle, recordDemoOrder: async () => undefined } as unknown as BotPersistence,
  });
  await bot.runCycle();
  expect(executeApprovedBuy).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ETH/USDT' }));
  expect(recordCycle).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTC/USDT', replayed: true }));
  expect(recordCycle).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTC/USDT', riskState: expect.objectContaining({ consecutiveLosses: 1 }) }));
  log.mockRestore();
});

it('blocks new Paper and Demo buys under the BTC filter while an existing Paper stop executes', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const now = 100 * 900_000;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    const candles = Array.from({ length: 98 }, (_, i) => ({
      timestamp: (i + 2) * 900_000, open: 100, high: 100.01, low: 99.99, close: 100, volume: 1,
    }));
    const btc = candles.map((c, i) => i === 97 ? { ...c, low: 80, close: 80 } : c);
    const paper = new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0, slippageRate: 0, stopLossRate: 0.1, takeProfitRate: 0.2 });
    paper.processCandle(btc[96]!, true);
    const manager = new CentralTradeManager({ maxConcurrentPositions: 3, maxExposurePercent: 1 });
    manager.recordEntry({ symbol: 'BTC/USDT', openedAt: btc[96]!.timestamp, notionalUsdt: 100 });
    const executeApprovedBuy = vi.fn();
    const inspectDemoEntry = vi.fn(async () => ({ allowed: true }));
    const recordCycle = vi.fn();
    const recordOperationalEvent = vi.fn();
    const bot = new TradingBot({ fetchClosedCandles: async (symbol: string) => symbol === 'BTC/USDT' ? btc : candles } as unknown as PublicMarketData, {
      symbol: 'BTC/USDT', candleLimit: 98, btcRegimeFilter: true, minimumConfidence: 0.8, aiFailureMode: 'quantitative',
      paperTrader: paper, tradeManager: manager, signalScanSymbols: ['ETH/USDT'], inspectDemoEntry,
      demoExecutor: { executeApprovedBuy } as unknown as OkxDemoExecutor,
      persistence: { isPaused: async () => false, recordCycle, recordOperationalEvent } as unknown as BotPersistence,
    });
    await bot.runCycle();
    expect(inspectDemoEntry).not.toHaveBeenCalled();
    expect(executeApprovedBuy).not.toHaveBeenCalled();
    expect(recordCycle).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ETH/USDT', decision: expect.objectContaining({ approved: false }) }));
    expect(recordCycle).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTC/USDT', riskState: expect.objectContaining({ consecutiveLosses: 1 }) }));
    expect(recordOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'BTC_REGIME_ENTRY_BLOCKED', details: expect.objectContaining({ reason: 'btc_regime_shock' }) }));
  } finally {
    clock.mockRestore();
    log.mockRestore();
  }
});


it.each([false, true])('handles an old Paper position with missing history = %s', async gap => {
  const candles = Array.from({ length: 85 }, (_, i) => ({ timestamp: (i + 10) * 900_000, open: 100, high: 100.01, low: 99.99, close: 100, volume: 1 }));
  const openedAt = candles[0]!.timestamp - (gap ? 2 : 1) * 900_000;
  const paper = new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0, slippageRate: 0, stopLossRate: 0.1, takeProfitRate: 0.2 });
  paper.processCandle({ ...candles[0]!, timestamp: openedAt }, true);
  const manager = new CentralTradeManager({ maxConcurrentPositions: 3, maxExposurePercent: 1 });
  manager.recordEntry({ symbol: 'BTC/USDT', openedAt, notionalUsdt: 100 });
  const recordCycle = vi.fn();
  const recordOperationalEvent = vi.fn();
  const executeApprovedBuy = vi.fn(async () => ({ status: 'PLACED' as const, orderId: '1', clientOrderId: 'CB1' }));
  const bot = new TradingBot({ fetchClosedCandles: async (symbol: string) => symbol === 'BTC/USDT'
    ? candles.map((c, i) => i === 5 ? { ...c, low: 80, close: 80 } : c) : candles } as unknown as PublicMarketData, {
    symbol: 'BTC/USDT', candleLimit: 85, minimumConfidence: .8, aiFailureMode: 'quantitative', paperTrader: paper,
    tradeManager: manager, signalScanSymbols: ['ETH/USDT'], inspectDemoEntry: async () => ({ allowed: true }),
    demoExecutor: { executeApprovedBuy } as unknown as OkxDemoExecutor,
    initialRiskState: { consecutiveLosses: 2, stopLossCooldownUntil: 0 }, maxConsecutiveLosses: 3,
    persistence: { isPaused: async () => false, readControlState: async () => ({ paused: false, revision: '42' }),
      recordCycle, recordOperationalEvent, recordDemoOrder: async () => undefined } as unknown as BotPersistence,
  });
  await bot.runCycle();
  if (gap) {
    expect(paper.hasOpenPosition).toBe(true);
    expect(recordCycle.mock.calls.some(([cycle]) => cycle.symbol === 'BTC/USDT')).toBe(false);
    expect(recordOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'PAPER_RECOVERY_BLOCKED' }));
  } else {
    expect(paper.hasOpenPosition).toBe(false);
    expect(recordCycle.mock.calls.filter(([cycle]) => cycle.lossPause)).toEqual([[
      expect.objectContaining({ symbol: 'BTC/USDT', lossPause: { controlRevision: '42' }, riskState: expect.objectContaining({ consecutiveLosses: 3 }) }),
    ]]);
    expect(executeApprovedBuy).not.toHaveBeenCalled();
  }
});

it('reuses aligned scan data, retries late pairs and lets cooled pairs rejoin', async () => {
  const candles = Array.from({ length: 86 }, (_, i) => ({ timestamp: i * 900000, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
  let end = 85, ethReady = false, paused = false;
  const fetchClosedCandles = vi.fn(async (symbol: string) => candles.slice(0, symbol === 'ETH/USDT' && !ethReady ? end - 1 : end));
  const selectSpotSymbols = vi.fn(async () => ['ETH/USDT', 'SOL/USDT']);
  const bot = new TradingBot({ active: 'okx', fetchClosedCandles, selectSpotSymbols } as unknown as PublicMarketData, {
    symbol: 'BTC/USDT', candleLimit: 85, minimumConfidence: .8, dynamicUniverseSize: 2,
    paperTrader: new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0, slippageRate: 0, stopLossRate: .1, takeProfitRate: .2 }),
    pairCooldown: { hours: 6, minLosses: 3 },
    persistence: {
      isPaused: async () => false, recordCycle: vi.fn(),
      activePairCooldowns: async () => paused ? [{ symbol: 'SOL/USDT', until: Date.now() + 1e6 }] : [],
    } as unknown as BotPersistence,
  });
  const scanCalls = (symbol: string) => fetchClosedCandles.mock.calls.filter(([pair, limit]: unknown[]) => pair === symbol && limit === 90).length;
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    paused = true;
    await bot.runCycle();
    expect(scanCalls('SOL/USDT')).toBe(0);
    expect(bot.getLastSignalScan()?.cooldowns).toEqual([expect.objectContaining({ symbol: 'SOL/USDT' })]);
    paused = false;
    ethReady = true;
    await bot.runCycle();
    await bot.runCycle();
    expect(selectSpotSymbols).toHaveBeenCalledTimes(1);
    expect(scanCalls('ETH/USDT')).toBe(2);
    expect(scanCalls('SOL/USDT')).toBe(1);
    end++;
    await bot.runCycle();
    expect(selectSpotSymbols).toHaveBeenCalledTimes(2);
    expect(scanCalls('ETH/USDT')).toBe(3);
  } finally {
    log.mockRestore();
  }
});

it.each([
  { replay: true, previousLosses: 2 },
  { replay: false, previousLosses: 2 },
  { replay: false, previousLosses: 1 },
])('checks persisted pair losses before reentry (replay=$replay, previous losses=$previousLosses)', async ({ replay, previousLosses }) => {
  const stopIndex = replay ? 83 : 84;
  const candles = Array.from({ length: 85 }, (_, i) => ({
    timestamp: i * 900_000, open: 100, high: 100.01, low: i === stopIndex ? 80 : 99.99, close: 100, volume: 1,
  }));
  const paperTrader = new PaperTrader({
    initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: 0, slippageRate: 0, stopLossRate: .1, takeProfitRate: .2,
  });
  paperTrader.processCandle(candles[stopIndex - 1]!, true);
  const inspectDemoEntry = vi.fn(async () => ({ allowed: true }));
  const executeApprovedBuy = vi.fn(async () => ({ status: 'PLACED' as const, orderId: '1', clientOrderId: 'CB1' }));
  let persistedLosses = previousLosses;
  const recordCycle = vi.fn(async (cycle: import('../src/persistence.js').PersistedCycle) => {
    persistedLosses += cycle.paperResult.events.filter(event => event.type === 'CLOSED' && event.netPnlUsdt < 0).length;
  });
  const bot = new TradingBot({ fetchClosedCandles: async () => candles } as unknown as PublicMarketData, {
    symbol: 'ETH/USDT', candleLimit: 85, minimumConfidence: .8, aiFailureMode: 'quantitative', paperTrader,
    pairCooldown: { hours: 6, minLosses: 3 }, inspectDemoEntry,
    demoExecutor: { executeApprovedBuy } as unknown as OkxDemoExecutor,
    persistence: {
      isPaused: async () => false, recordCycle, recordOperationalEvent: vi.fn(), recordDemoOrder: vi.fn(),
      activePairCooldowns: async () => persistedLosses >= 3 ? [{ symbol: 'ETH/USDT', until: Date.now() + 21_600_000 }] : [],
    } as unknown as BotPersistence,
  });

  await bot.runCycle();

  expect(persistedLosses).toBe(previousLosses + 1);
  expect(paperTrader.hasOpenPosition).toBe(false);
  expect(inspectDemoEntry).toHaveBeenCalledTimes(previousLosses === 2 ? 0 : 1);
  expect(executeApprovedBuy).toHaveBeenCalledTimes(previousLosses === 2 ? 0 : 1);
  expect(bot.getLastSignalScan()?.cooldowns).toHaveLength(previousLosses === 2 ? 1 : 0);
});

it.each(['demo_spread_exceeded', 'demo_book_unavailable'] as const)('checks %s before persisting Paper or admitting Demo', async reason => {
  const candles = Array.from({ length: 85 }, (_, i) => ({ timestamp: i * 900_000, open: 100, high: 100.01, low: 99.99, close: 100, volume: 1 }));
  const paperTrader = new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 10, feeRate: 0, slippageRate: 0, stopLossRate: .1, takeProfitRate: .2 });
  const inspectEntryMarket = vi.fn(async () => ({ status: 'blocked' as const, reason }));
  const inspectDemoEntry = vi.fn();
  const executeApprovedBuy = vi.fn();
  const recordCycle = vi.fn();
  const recordOperationalEvent = vi.fn();
  const bot = new TradingBot({ fetchClosedCandles: async () => candles } as unknown as PublicMarketData, {
    symbol: 'ETH/USDT', candleLimit: 85, minimumConfidence: .8, aiFailureMode: 'quantitative', paperTrader,
    inspectEntryMarket, inspectDemoEntry, demoExecutor: { executeApprovedBuy },
    persistence: { isPaused: async () => false, recordCycle, recordOperationalEvent } as unknown as BotPersistence,
  });

  await bot.runCycle();

  expect(inspectEntryMarket).toHaveBeenCalledWith('ETH/USDT');
  expect(recordCycle).toHaveBeenCalledWith(expect.objectContaining({
    paperResult: expect.objectContaining({ events: [] }),
    decision: expect.objectContaining({ approved: false }),
  }));
  expect(inspectDemoEntry).not.toHaveBeenCalled();
  expect(executeApprovedBuy).not.toHaveBeenCalled();
  expect(recordOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'DEMO_ENTRY_DECISION', details: expect.objectContaining({ approved: false, reason }),
  }));
});

it('keeps the recorded Paper opening and its alert when the spread widens before Demo execution', async () => {
  const candles = Array.from({ length: 85 }, (_, i) => ({ timestamp: i * 900_000, open: 100, high: 100.01, low: 99.99, close: 100, volume: 1 }));
  const paperTrader = new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 10, feeRate: 0, slippageRate: 0, stopLossRate: .1, takeProfitRate: .2 });
  const recordCycle = vi.fn();
  const recordDemoOrder = vi.fn();
  const recordOperationalEvent = vi.fn();
  const sendOpened = vi.fn();
  const bot = new TradingBot({ fetchClosedCandles: async () => candles } as unknown as PublicMarketData, {
    symbol: 'ETH/USDT', candleLimit: 85, minimumConfidence: .8, aiFailureMode: 'quantitative', paperTrader,
    inspectEntryMarket: async () => ({ status: 'safe' }),
    inspectDemoEntry: async () => ({ allowed: true }),
    demoExecutor: { executeApprovedBuy: async () => ({ status: 'SKIPPED', reason: 'demo_spread_exceeded', clientOrderId: 'CB1' }) },
    emailAlerts: { sendOpened, sendClosed: vi.fn() } as unknown as import('../src/email-alerts.js').EmailTradeAlert,
    persistence: { isPaused: async () => false, recordCycle, recordDemoOrder, recordOperationalEvent } as unknown as BotPersistence,
  });

  await bot.runCycle();

  expect(recordCycle).toHaveBeenCalledWith(expect.objectContaining({
    paperResult: expect.objectContaining({ events: [expect.objectContaining({ type: 'OPENED' })] }),
  }));
  expect(recordDemoOrder).not.toHaveBeenCalled();
  expect(recordOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'DEMO_ENTRY_DECISION', details: expect.objectContaining({ stage: 'execution', paperOpened: true, reason: 'demo_spread_exceeded' }),
  }));
  expect(sendOpened).toHaveBeenCalledWith('ETH/USDT', expect.objectContaining({ type: 'OPENED' }));
});
