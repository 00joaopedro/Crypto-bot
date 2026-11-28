import { expect, it, vi } from 'vitest';
import { advanceDemoRisk } from '../src/demo-risk.js';
import { inspectDemoEntry } from '../src/demo-entry.js';
const identity = { uid: '1', mainUid: '1' };
const baseline = { observedAt: new Date(1000), balances: { USDT: 100 }, evidence: { accountIdentity: identity }, status: 'UNVERIFIED' };
const input = { symbol: 'BTC/USDT', size: 10, stopLossRate: 0.01, cooldownMinutes: 60, maxPositions: 2, maxExposure: 0.5, riskPerTrade: 0.01, maxDailyLoss: 0.05, maxDrawdown: 0.1 };
const persistence = { getDemoBaselineCandidate: async () => baseline, demoOrderJournal: async () => [], observeDemoRisk: async (_id: string, equity: number, at: number) => advanceDemoRisk(null, equity, at), canEnterDemoSymbol: async () => true };
const executor = { inspectAccountIdentity: async () => ({ status: 'confirmed' as const, identity }), collectOrderEvidence: vi.fn(), getAccountSnapshot: async () => ({ equityUsdt: 100, quoteFree: 100, totalUsdt: 100, quoteCurrency: 'USDT', unvaluedAssets: [], updatedAt: '' }) };
it('admits a verified empty Demo journal without consulting Paper', async () => {
  expect(await inspectDemoEntry(persistence, executor, input)).toEqual({ allowed: true });
});
it('blocks uncertain submissions, cooldown, unavailable balances and excessive risk', async () => {
  const row = { status: 'PENDING', client_order_id: '1', symbol: 'BTC/USDT', attached_algo_client_id: null, result: {}, created_at: new Date(2000) };
  expect(await inspectDemoEntry({ ...persistence, demoOrderJournal: async () => [row] }, executor, input)).toMatchObject({ allowed: false, reason: 'pending_demo_order' });
  expect(await inspectDemoEntry({ ...persistence, canEnterDemoSymbol: async () => false }, executor, input)).toMatchObject({ reason: 'demo_entry_cooldown' });
  expect(await inspectDemoEntry(persistence, executor, { ...input, maxExposure: 0.01 })).toMatchObject({ reason: 'demo_max_exposure' });
  expect(await inspectDemoEntry(persistence, executor, { ...input, riskPerTrade: 0.00001 })).toMatchObject({ reason: 'demo_risk_per_trade' });
  expect(await inspectDemoEntry(persistence, { ...executor, getAccountSnapshot: async () => ({ ...await executor.getAccountSnapshot(), equityUsdt: null }) }, input)).toMatchObject({ reason: 'demo_balance_unconfirmed' });
});


it('explains a Demo refusal using the configured order and full account exposure', async () => {
  const getAccountSnapshot = async () => ({ ...await executor.getAccountSnapshot(), equityUsdt: 200 });
  expect(await inspectDemoEntry(persistence, { ...executor, getAccountSnapshot }, input)).toEqual({
    allowed: false, reason: 'demo_max_exposure',
    exposure: { equityUsdt: 200, freeUsdt: 100, exposureUsdt: 100, tradingEquityUsdt: 200, brlReserveUsdt: 0, scope: 'account', requestedUsdt: 10, projectedRate: 0.55, limitRate: 0.5 },
  });
});

it('keeps free BRL out of exposure and the budget while retaining locked balances', async () => {
  const snapshot = await executor.getAccountSnapshot();
  const getAccountSnapshot = async () => ({ ...snapshot, equityUsdt: 900, freeBrlValueUsdt: 800 });
  expect(await inspectDemoEntry(persistence, { ...executor, getAccountSnapshot }, input)).toEqual({ allowed: true });
  const withLockedFunds = async () => ({ ...await getAccountSnapshot(), freeBrlValueUsdt: 700 });
  expect(await inspectDemoEntry(persistence, { ...executor, getAccountSnapshot: withLockedFunds }, input))
    .toMatchObject({ allowed: false, reason: 'demo_max_exposure', exposure: { exposureUsdt: 100, tradingEquityUsdt: 200 } });
  expect(await inspectDemoEntry(persistence, { ...executor, getAccountSnapshot }, { ...input, size: 110 }))
    .toMatchObject({ reason: 'demo_insufficient_quote_balance' });
  const unvalued = async () => ({ ...await getAccountSnapshot(), unvaluedAssets: ['ETH'] });
  expect(await inspectDemoEntry(persistence, { ...executor, getAccountSnapshot: unvalued }, input))
    .toMatchObject({ reason: 'demo_balance_unconfirmed' });
});

it.each([6, 10])('uses the 10-position limit independently when %i positions remain open', async count => {
  const fixtures = Array.from({ length: count }, (_, i) => ({
    id: String(i + 1), clientOrderId: `CB${i}`, algoId: `AP${i}`, symbol: `PAIR${i}/USDT`,
  }));
  const rows = fixtures.map(item => ({
    status: 'PLACED', client_order_id: item.clientOrderId, symbol: item.symbol,
    attached_algo_client_id: item.algoId, result: { orderId: item.id }, created_at: new Date(2000),
  }));
  const collectOrderEvidence = async () => ({
    status: 'collected' as const,
    buys: fixtures.map(item => ({ id: item.id, clientOrderId: item.clientOrderId, symbol: item.symbol, side: 'buy' as const, attachedAlgoClientIds: [item.algoId] })),
    sells: [],
    protections: fixtures.map(item => ({ algoClientId: item.algoId, symbol: item.symbol, side: 'sell' as const, spawnedOrderIds: [] })),
    protectionStates: Object.fromEntries(fixtures.map(item => [item.algoId, 'live' as const])),
    orders: fixtures.map(item => ({ id: item.id, symbol: item.symbol, side: 'buy' as const, filled: 1, terminal: true, ownershipConfirmed: false })),
  });
  const result = await inspectDemoEntry({ ...persistence, demoOrderJournal: async () => rows }, { ...executor, collectOrderEvidence }, { ...input, maxPositions: 10 });
  expect(result).toEqual(count === 6 ? { allowed: true } : { allowed: false, reason: 'demo_max_concurrent_positions' });
});

it('admits 10 USDT against the bot allocation and uses attributed equity for loss limits', async () => {
  const observeDemoRisk = vi.fn(persistence.observeDemoRisk);
  const store = { ...persistence, observeDemoRisk, readDemoEntryRevision: async () => '0:0' };
  const getAccountSnapshot = async () => ({
    ...await executor.getAccountSnapshot(),
    updatedAt: new Date().toISOString(), equityUsdt: 84_488.05, quoteFree: 5000, totalUsdt: 5000, freeBrlValueUsdt: 4672.90,
  });
  const account = { ...executor, getAccountSnapshot };
  const options = { ...input, maxExposure: 0.1, inspectAccounting: async () => ({ status: 'confirmed' as const, realizedPnlUsdt: 0, positions: {}, confirmedThrough: Date.now() }) };
  await expect(inspectDemoEntry(store, account, options)).resolves.toMatchObject({
    reason: 'demo_max_exposure', exposure: { scope: 'account', exposureUsdt: expect.closeTo(74_815.15) },
  });
  await expect(inspectDemoEntry(store, account, { ...options, botBudgetUsdt: 5000 })).resolves.toEqual({
    allowed: true, entryRevision: '0:0', exposurePositions: [],
  });
  expect(observeDemoRisk).toHaveBeenLastCalledWith('1:1:bot-equity-v1', 5000, expect.any(Number), { budgetUsdt: 5000, baselineAt: 1000 });
  await expect(inspectDemoEntry({
    ...store, observeDemoRisk: async () => ({ day: '2026-11-17', dayStartEquity: 100_000, peakEquity: 100_000, equity: 84_488.05, observedAt: Date.now() }),
  }, account, { ...options, botBudgetUsdt: 5000 })).resolves.toMatchObject({ reason: 'demo_daily_loss_limit' });
  await expect(inspectDemoEntry(persistence, account, { ...options, botBudgetUsdt: 5000 })).resolves.toMatchObject({
    reason: 'demo_risk_revision_unavailable',
  });
});
