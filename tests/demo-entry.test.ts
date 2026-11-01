import { expect, it, vi } from 'vitest';
import { inspectDemoEntry } from '../src/demo-entry.js';
const identity = { uid: '1', mainUid: '1' };
const baseline = { observedAt: new Date(1000), balances: { USDT: 100 }, evidence: { accountIdentity: identity }, status: 'UNVERIFIED' };
const input = { symbol: 'BTC/USDT', size: 10, stopLossRate: 0.01, cooldownMinutes: 60, maxPositions: 2, maxExposure: 0.5, riskPerTrade: 0.01 };
const persistence = { getDemoBaselineCandidate: async () => baseline, demoOrderJournal: async () => [], canEnterDemoSymbol: async () => true };
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
