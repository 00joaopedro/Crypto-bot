import { expect, it, vi } from 'vitest';
import { inspectDemoAccounting } from '../src/demo-diagnostic.js';
it('continues a flat checkpoint without re-reading old fills and retains total P&L', async () => {
  const now = Date.now();
  const identity = { uid: '1', mainUid: '1' };
  const original = { observedAt: new Date(now-10*86400000), balances: { USDT: 100 }, evidence: { accountIdentity: identity }, status: 'UNVERIFIED' };
  const checkpoint = { ...original, observedAt: new Date(now-60000), balances: { USDT: 110 }, evidence: { accountIdentity: identity, startedAt: now-61000 }, realizedPnlOffset: 10 };
  const saveDemoAccountingCheckpoint = vi.fn();
  const persistence = { demoOrderJournal: async () => [{ status: 'PLACED', client_order_id: 'old', symbol: 'BTC/USDT', attached_algo_client_id: 'old', result: {}, created_at: new Date(now-86400000) }], getDemoBaselineCandidate: async () => original, getDemoAccountingCheckpoint: async () => checkpoint, saveDemoAccountingCheckpoint };
  const executor = { inspectAccountIdentity: async () => ({ status: 'confirmed' as const, identity }), collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountBalances: async () => ({ status: 'collected' as const, startedAt: now-1000, endedAt: now-900, balances: { USDT: 110 } }), collectAccountCoverage: async () => ({ status: 'covered' as const, billCount: 0 }) };
  expect(await inspectDemoAccounting(persistence, executor)).toMatchObject({ status: 'confirmed', realizedPnlUsdt: 10 });
  expect(executor.collectFillHistory).not.toHaveBeenCalled();
  expect(saveDemoAccountingCheckpoint).toHaveBeenCalledOnce();
  expect(await inspectDemoAccounting(persistence, { ...executor, collectAccountCoverage: async () => ({ status: 'unavailable' as const, reason: 'unattributed_account_bill' }) })).toMatchObject({ status: 'unavailable', reason: 'unattributed_account_bill' });
  expect(saveDemoAccountingCheckpoint).toHaveBeenCalledOnce();
});
