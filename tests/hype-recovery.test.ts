import { auditDemoProtections } from '../src/demo-exit-supervisor.js';
import { expect, it, vi } from 'vitest';
import { explicitDemoRejection } from '../src/demo-rejection.js';
import { DemoSymbolAccess } from '../src/demo-symbol-access.js';
import { autoResumeAt } from '../src/auto-resume.js';
import { collectPaperHistory } from '../src/paper-history.js';

const response = (change = {}) => ({ error: 'okx ' + JSON.stringify({ code: '1', data: [{ clOrdId: 'CBHYPE', ordId: '', sCode: '51155', sMsg: "You can't trade this pair or borrow this crypto due to local compliance restrictions. ", ...change }] }) });
it('recognizes the exact HYPE rejection without treating ambiguous failures as rejected orders', () => {
  expect(explicitDemoRejection(response(), 'CBHYPE')).toMatchObject({ code: '51155' });
  for (const value of [response({ clOrdId: 'OTHER' }), response({ ordId: 'existing-order' }), response({ sCode: '50004' }), response({ sMsg: 'timeout' }),
    { error: '51155' }, { error: 'okx {broken' }, { error: 'okx ' + JSON.stringify({ code: '1', data: [JSON.parse(response().error.slice(4)).data[0], {}] }) }]) {
    expect(explicitDemoRejection(value, 'CBHYPE')).toBeNull();
  }
});

it('persists the restriction across restart, rechecks privately after six hours and isolates accounts', async () => {
  let rows = [{ symbol: 'HYPE/USDT', rejected_at: new Date(1000), client_order_id: 'CBHYPE' }];
  const store = { demoSymbolRestrictions: vi.fn(async () => rows), releaseDemoSymbolRestriction: vi.fn(async () => { rows = []; }) };
  const executor = { inspectAccountIdentity: async () => ({ status: 'confirmed' as const, identity: { uid: '1', mainUid: '1' } }), availableAccountSymbols: vi.fn(async () => ['BTC/USDT', 'HYPE/USDT']) };
  const gate = new DemoSymbolAccess(store, executor);
  expect(await gate.symbols(2000)).toEqual(new Set(['BTC/USDT']));
  expect(await new DemoSymbolAccess(store, executor).symbols(3000)).toEqual(new Set(['BTC/USDT']));
  const at = 6 * 3600_000 + 1000;
  expect(await gate.symbols(at)).toEqual(new Set(['BTC/USDT']));
  expect(await gate.symbols(at + 1)).toEqual(new Set(['BTC/USDT', 'HYPE/USDT']));
  expect(store.releaseDemoSymbolRestriction).toHaveBeenCalledWith('1:1', 'HYPE/USDT', 'CBHYPE');
  executor.availableAccountSymbols.mockRejectedValueOnce(new Error('timeout'));
  await expect(gate.symbols(at + 300_001)).rejects.toThrow('timeout');
  expect(store.demoSymbolRestrictions).toHaveBeenCalledWith('1:1');
});

it('cannot release a restricted pair missing from the private catalogue or use another account cache', async () => {
  const store = { demoSymbolRestrictions: async () => [{ symbol: 'HYPE/USDT', rejected_at: new Date(1000), client_order_id: 'id' }], releaseDemoSymbolRestriction: vi.fn() };
  let uid = '1';
  const executor = { inspectAccountIdentity: async () => ({ status: 'confirmed' as const, identity: { uid, mainUid: uid } }), availableAccountSymbols: vi.fn(async () => ['BTC/USDT']) };
  const gate = new DemoSymbolAccess(store, executor);
  await gate.symbols(7 * 3600_000);
  expect(store.releaseDemoSymbolRestriction).not.toHaveBeenCalled();
  uid = '2'; executor.availableAccountSymbols.mockRejectedValueOnce(new Error('unavailable'));
  await expect(gate.symbols(7 * 3600_000 + 1)).rejects.toThrow();
});

it('only permits reevaluation of the technical pause; manual and drawdown pauses stay manual', () => {
  const control = { paused: true, revision: '1', updatedBy: 'system:demo_order_not_confirmed', updatedAt: new Date(1000), pauseReason: 'demo_order_not_confirmed' };
  expect(autoResumeAt(control, 120, true)).toBe(1000);
  expect(autoResumeAt({ ...control, updatedBy: 'dashboard' }, 120, true)).toBeNull();
  expect(autoResumeAt({ ...control, pauseReason: 'demo_drawdown_limit' }, 120, true)).toBeNull();
});

const STEP = 900_000;
const data = Array.from({ length: 501 }, (_, i) => [i * STEP, 100, 101, 99, 100, 1]);
it('recovers multiple pages with warmup and rejects gaps, conflicting duplicates and exhausted budget', async () => {
  const fetch = vi.fn(async (since: number, limit: number) => data.filter(r => r[0]! >= since).slice(0, limit));
  const result = await collectPaperHistory(100 * STEP, 500 * STEP, fetch);
  expect(result).toHaveLength(501); expect(fetch).toHaveBeenCalledTimes(6);
  await expect(collectPaperHistory(100 * STEP, 500 * STEP, async (since, limit) => data.filter(r => r[0]! >= since && r[0] !== 200 * STEP).slice(0, limit))).rejects.toThrow(/gap/);
  await expect(collectPaperHistory(0, STEP, async () => [[0,100,101,99,100,1],[0,100,102,99,100,1]])).rejects.toThrow(/conflicting/);
  await expect(collectPaperHistory(0, STEP, async () => [])).rejects.toThrow(/incomplete/);
  await expect(collectPaperHistory(0, 40 * STEP, async since => [[since,100,101,99,100,1]])).rejects.toThrow(/budget/);
});


it('audits the other five confirmed buys even when a separate intent is pending and one protection lookup fails', async () => {
  const identity = { uid: '1', mainUid: '1' };
  const observedAt = new Date(Date.now() - 100_000);
  const rows = ['DOGE','ADA','ETH','NEAR','UNI'].map((base,i) => ({ symbol: base+'/USDT', client_order_id: 'CB'+i,
    attached_algo_client_id: 'AP'+i, status: 'PLACED', result: { orderId: String(i) }, created_at: new Date() }));
  const store = { demoOrderJournal: async () => [...rows, { ...rows[0]!, client_order_id: 'PENDING', status: 'PENDING', symbol: 'HYPE/USDT' }],
    getDemoBaselineCandidate: async () => ({ observedAt, balances: {}, evidence: { accountIdentity: identity }, status: 'UNVERIFIED' }),
    getDemoAccountingCheckpoint: async () => null };
  const inspectExitProtection = vi.fn(async (row: { symbol: string }) => {
    if (row.symbol === 'DOGE/USDT') throw new Error('timeout');
    return { status: 'closed' as const };
  });
  const executor = { inspectAccountIdentity: async () => ({ status: 'confirmed' as const, identity }), inspectExitProtection };
  expect(await auditDemoProtections(store, executor)).toMatchObject({ status: 'blocked', reason: 'protection_audit_failed', failures: [{ symbol: 'DOGE/USDT', reason: 'protection_audit_failed' }] });
  expect(inspectExitProtection).toHaveBeenCalledTimes(5);
});
