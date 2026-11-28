import { expect, it, vi } from 'vitest';
import { inspectDemoAccounting } from '../src/demo-diagnostic.js';
import { inspectDemoEquityRisk } from '../src/demo-entry.js';
import { autoResumeAt } from '../src/auto-resume.js';
import type { PostgresPersistence } from '../src/persistence.js';

function setup() {
  const now = Date.now();
  const identity = { uid: '1', mainUid: '1' };
  const baseline = { observedAt: new Date(now - 120_000), balances: { USDT: 5000 },
    evidence: { startedAt: now - 121_000, accountIdentity: identity }, status: 'UNVERIFIED' };
  const store = { demoOrderJournal: vi.fn(async () => []), getDemoBaselineCandidate: vi.fn(async () => baseline),
    getDemoAccountingCheckpoint: vi.fn(async (): Promise<Awaited<ReturnType<PostgresPersistence['getDemoAccountingCheckpoint']>>> => null),
    saveDemoAccountingCheckpoint: vi.fn(async () => true), observeDemoRisk: vi.fn() };
  const executor = { inspectAccountIdentity: vi.fn(async () => ({ status: 'confirmed' as const, identity })),
    collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(),
    collectAccountCoverage: vi.fn(async () => ({ status: 'covered' as const, billCount: 0 })),
    collectAccountBalances: vi.fn(async () => ({ status: 'collected' as const, startedAt: Date.now()-1,
      endedAt: Date.now(), balances: { USDT: 5000 } })), getAccountSnapshot: vi.fn(),
  };
  return { store, executor, baseline, now };
}

it('shares the in-flight exchange inspection across dashboard/risk callers and never caches completed success', async () => {
  const { store, executor } = setup();
  const requests = Array.from({ length: 20 }, () => inspectDemoAccounting(store, executor));
  expect(requests.every(request => request === requests[0])).toBe(true);
  const results = await Promise.all(requests);
  expect(results.every(result => result.status === 'confirmed')).toBe(true);
  expect(store.saveDemoAccountingCheckpoint).toHaveBeenCalledTimes(1);
  expect(executor.collectAccountBalances).toHaveBeenCalledTimes(2);
  await inspectDemoAccounting(store, executor);
  expect(store.saveDemoAccountingCheckpoint).toHaveBeenCalledTimes(2);
  expect(executor.collectAccountBalances).toHaveBeenCalledTimes(4);
});

it('restarts all evidence collection from the checkpoint actually committed by another writer', async () => {
  const { store, executor, baseline, now } = setup();
  store.saveDemoAccountingCheckpoint.mockResolvedValueOnce(false);
  store.getDemoAccountingCheckpoint.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...baseline,
    observedAt: new Date(now-1000), evidence: { ...baseline.evidence, startedAt: now-1100 }, realizedPnlOffset: 7 });
  const result = await inspectDemoAccounting(store, executor);
  expect(result).toMatchObject({ status: 'confirmed', realizedPnlUsdt: 7 });
  expect(executor.inspectAccountIdentity).toHaveBeenCalledTimes(2);
  expect(executor.collectAccountBalances).toHaveBeenCalledTimes(4);
  expect(store.saveDemoAccountingCheckpoint).toHaveBeenCalledTimes(2);
});

it('stops after one complete retry; unresolved contention stays blocked and does not update risk', async () => {
  const { store, executor } = setup();
  store.saveDemoAccountingCheckpoint.mockResolvedValue(false);
  const result = await inspectDemoEquityRisk(store, executor, .03, .1, {
    botBudgetUsdt: 5000, inspectAccounting: () => inspectDemoAccounting(store, executor),
  });
  expect(result).toMatchObject({ status: 'blocked', reason: 'demo_accounting_checkpoint_busy', attributionReason: 'checkpoint_changed_retry' });
  expect(store.saveDemoAccountingCheckpoint).toHaveBeenCalledTimes(2);
  expect(store.observeDemoRisk).not.toHaveBeenCalled();
  expect(executor.getAccountSnapshot).not.toHaveBeenCalled();
  const control = { paused: true, revision: '1', updatedBy: 'system:demo_execution_safety',
    updatedAt: new Date(), pauseReason: 'demo_accounting_checkpoint_busy' };
  expect(autoResumeAt(control, 120, true)).toBe(control.updatedAt.getTime());
  expect(autoResumeAt({ ...control, updatedBy: 'dashboard' }, 120, true)).toBeNull();
});

it('does not retry unattributed movements, substitute old P&L or ignore a new error after a conflict', async () => {
  const a = setup();
  a.executor.collectAccountBalances.mockResolvedValue({ status: 'collected', startedAt: Date.now()-1, endedAt: Date.now(), balances: { USDT: 4990 } });
  expect(await inspectDemoAccounting(a.store, a.executor)).toMatchObject({ status: 'unavailable', reason: 'balance_changed_since_checkpoint' });
  expect(a.store.demoOrderJournal).toHaveBeenCalledTimes(1);
  expect(a.store.saveDemoAccountingCheckpoint).not.toHaveBeenCalled();
  const b = setup();
  b.store.saveDemoAccountingCheckpoint.mockResolvedValueOnce(false);
  b.executor.inspectAccountIdentity.mockResolvedValueOnce({ status: 'confirmed', identity: { uid: '1', mainUid: '1' } })
    .mockResolvedValueOnce({ status: 'confirmed', identity: { uid: '2', mainUid: '2' } });
  expect(await inspectDemoAccounting(b.store, b.executor)).toMatchObject({ reason: 'account_identity_mismatch_or_missing' });
  expect(b.store.saveDemoAccountingCheckpoint).toHaveBeenCalledTimes(1);
});

it('releases failed work and never shares another executor account or persistence context', async () => {
  const { store, executor } = setup();
  store.demoOrderJournal.mockRejectedValueOnce(new Error('database offline'));
  await expect(inspectDemoAccounting(store, executor)).rejects.toThrow('database offline');
  expect(await inspectDemoAccounting(store, executor)).toMatchObject({ status: 'confirmed' });
  const other = { ...executor, inspectAccountIdentity: vi.fn(async () => ({ status: 'confirmed' as const, identity: { uid: '2', mainUid: '2' } })) };
  const requests = [inspectDemoAccounting(store, executor), inspectDemoAccounting(store, other)];
  expect(requests[0]).not.toBe(requests[1]);
  const results = await Promise.all(requests);
  expect(results[0]?.status).toBe('confirmed');
  expect(results[1]).toMatchObject({ reason: 'account_identity_mismatch_or_missing' });
  const second = { ...store };
  const independent = [inspectDemoAccounting(store, executor), inspectDemoAccounting(second, executor)];
  expect(independent[0]).not.toBe(independent[1]);
  await Promise.all(independent);
});
