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
it('selects the Demo candidate while monitoring a different Paper position', async () => {
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
    persistence: { isPaused: async () => false, recordCycle, recordDemoOrder: async () => undefined } as unknown as BotPersistence,
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
