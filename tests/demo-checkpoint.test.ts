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

it('starts a zero-P&L checkpoint only after proving an unchanged account with no orders', async () => {
  const now = Date.now(); const identity = { uid: '1', mainUid: '1' };
  const baseline = { observedAt: new Date(now-60000), balances: { USDT: 100 }, evidence: { startedAt: now-61000, accountIdentity: identity }, status: 'UNVERIFIED' };
  const saveDemoAccountingCheckpoint = vi.fn();
  const persistence = { demoOrderJournal: async () => [], getDemoBaselineCandidate: async () => baseline, saveDemoAccountingCheckpoint };
  const executor = { inspectAccountIdentity: async () => ({ status: 'confirmed' as const, identity }), collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(), collectAccountBalances: async () => ({ status: 'collected' as const, startedAt: now-1000, endedAt: now-900, balances: { USDT: 100 } }), collectAccountCoverage: async () => ({ status: 'covered' as const, billCount: 0 }) };
  expect(await inspectDemoAccounting(persistence, executor)).toMatchObject({ status: 'confirmed', realizedPnlUsdt: 0 });
  expect(saveDemoAccountingCheckpoint).toHaveBeenCalledOnce();
});

it('retains an open purchase and its fees across checkpoints and reconciles a later partial sell', async () => {
  const now = Date.now()-60_000, origin = now-20*86400000, at = now-86400000;
  const identity = { uid: '1', mainUid: '1' };
  const buyFill = { id: 'f1', orderId: 'b1', symbol: 'BTC/USDT', side: 'buy' as const, timestamp: origin+2000, amount: 1, costUsdt: 100, fees: [{ currency: 'USDT', cost: 1 }] };
  const sellFill = { id: 'f2', orderId: 's1', symbol: 'BTC/USDT', side: 'sell' as const, timestamp: now-5000, amount: 0.5, costUsdt: 60, fees: [{ currency: 'USDT', cost: 0.6 }] };
  const baseline = { observedAt: new Date(origin), balances: { USDT: 1000 }, evidence: { accountIdentity: identity, startedAt: origin-100 }, status: 'UNVERIFIED' };
  const checkpoint = { ...baseline, observedAt: new Date(at), balances: { BTC: 1, USDT: 899 }, realizedPnlOffset: 0, evidence: { ...baseline.evidence, startedAt: at-100, ledgerCarry: { from: origin, balances: baseline.balances, pnlOffset: 0, fills: [buyFill] } } };
  const saveDemoAccountingCheckpoint = vi.fn();
  const persistence = { getDemoBaselineCandidate: async () => baseline, getDemoAccountingCheckpoint: async () => checkpoint, saveDemoAccountingCheckpoint, demoOrderJournal: async () => [{ client_order_id: 'CB1', symbol: 'BTC/USDT', status: 'PLACED', result: { orderId: 'b1' }, attached_algo_client_id: 'AP1', created_at: new Date(origin+1000) }] };
  const executor = {
    inspectAccountIdentity: async () => ({ status: 'confirmed' as const, identity }),
    collectAccountBalances: async () => ({ status: 'collected' as const, startedAt: now-1000, endedAt: now-900, balances: { BTC: 0.5, USDT: 958.4 } }),
    collectAccountCoverage: async () => ({ status: 'covered' as const, billCount: 1 }),
    collectFillHistory: vi.fn(async () => ({ status: 'collected' as const, fills: [sellFill], from: at, to: now })),
    collectOrderEvidence: async () => ({ status: 'collected' as const, buys: [{ id: 'b1', clientOrderId: 'CB1', symbol: 'BTC/USDT', side: 'buy' as const, attachedAlgoClientIds: ['AP1'] }], sells: [{ id: 's1', clientOrderId: null, symbol: 'BTC/USDT', side: 'sell' as const }], protections: [{ algoClientId: 'AP1', symbol: 'BTC/USDT', side: 'sell' as const, spawnedOrderIds: ['s1'] }], protectionStates: { AP1: 'live' }, orders: [{ id: 'b1', symbol: 'BTC/USDT', side: 'buy' as const, filled: 1, terminal: true, ownershipConfirmed: false }, { id: 's1', symbol: 'BTC/USDT', side: 'sell' as const, filled: 0.5, terminal: true, ownershipConfirmed: false }] }),
  };
  const result = await inspectDemoAccounting(persistence, executor);
  expect(result.status).toBe('confirmed');
  if (result.status === 'confirmed') expect(result.realizedPnlUsdt).toBeCloseTo(8.9);
  expect(executor.collectFillHistory).toHaveBeenCalledWith(expect.objectContaining({ from: at-1000 }));
  const saved = saveDemoAccountingCheckpoint.mock.calls[0]?.[0];
  expect(saved.evidence.ledgerCarry.fills).toHaveLength(2);
  saved.evidence.ledgerCarry.fills = saved.evidence.ledgerCarry.fills.map((fill: Record<string, unknown>) => Object.fromEntries(Object.entries(fill).sort(([a], [b]) => a.localeCompare(b))));
  const replayed = await inspectDemoAccounting({ ...persistence, getDemoAccountingCheckpoint: async () => ({ observedAt: new Date(saved.observedAt), balances: saved.balances, evidence: saved.evidence, status: 'UNVERIFIED', realizedPnlOffset: saved.realizedPnl }) }, { ...executor, collectFillHistory: async () => ({ status: 'collected' as const, fills: [sellFill], from: saved.observedAt-1000, to: now }) });
  expect(replayed.status).toBe('confirmed');
  if (replayed.status === 'confirmed') expect(replayed.realizedPnlUsdt).toBeCloseTo(8.9);
  const partialCheckpoint=saveDemoAccountingCheckpoint.mock.calls.at(-1)![0];
  const closeFill={...sellFill,id:'f3',orderId:'s2',timestamp:now,costUsdt:55,fees:[{currency:'USDT',cost:0.55}]};
  const partial={observedAt:new Date(partialCheckpoint.observedAt),balances:partialCheckpoint.balances,evidence:partialCheckpoint.evidence,status:'UNVERIFIED',realizedPnlOffset:partialCheckpoint.realizedPnl};
  const previousEvidence=await executor.collectOrderEvidence();
  const closedExecutor={...executor,
    collectAccountBalances:async()=>({status:'collected' as const,startedAt:now+1000,endedAt:now+1100,balances:{BTC:0,USDT:1012.85}}),
    collectFillHistory:async()=>({status:'collected' as const,fills:[closeFill],from:now-1900,to:now+1000}),
    collectOrderEvidence:async()=>({...previousEvidence,sells:[...previousEvidence.sells,{id:'s2',clientOrderId:null,symbol:'BTC/USDT',side:'sell' as const}],protections:[{...previousEvidence.protections[0]!,spawnedOrderIds:['s1','s2']}],orders:[...previousEvidence.orders,{id:'s2',symbol:'BTC/USDT',side:'sell' as const,filled:0.5,terminal:true,ownershipConfirmed:false}],protectionStates:{AP1:'effective'}}),
  };
  const closed=await inspectDemoAccounting({...persistence,getDemoAccountingCheckpoint:async()=>partial},closedExecutor);
  expect(closed.status).toBe('confirmed');
  if(closed.status==='confirmed')expect(closed.realizedPnlUsdt).toBeCloseTo(12.85);
  const finalCheckpoint=saveDemoAccountingCheckpoint.mock.calls.at(-1)![0];
  expect(finalCheckpoint.evidence.ledgerCarry).toBeUndefined();
  const idle=await inspectDemoAccounting({...persistence,getDemoAccountingCheckpoint:async()=>({observedAt:new Date(finalCheckpoint.observedAt),balances:finalCheckpoint.balances,evidence:finalCheckpoint.evidence,status:'UNVERIFIED',realizedPnlOffset:finalCheckpoint.realizedPnl})},{...closedExecutor,
    collectAccountBalances:async()=>({status:'collected' as const,startedAt:now+10000,endedAt:now+10100,balances:{BTC:0,USDT:1012.85}}),
    collectAccountCoverage:async()=>({status:'covered' as const,billCount:0}),collectFillHistory:vi.fn(),
  });
  expect(idle.status).toBe('confirmed');
  if(idle.status==='confirmed')expect(idle.realizedPnlUsdt).toBeCloseTo(12.85);

});

it('refuses a checkpoint when its predecessor changes during reconciliation', async () => {
  const now=Date.now(), identity={uid:'1',mainUid:'1'};
  const baseline={ observedAt:new Date(now-60000), balances:{USDT:100}, evidence:{startedAt:now-61000,accountIdentity:identity},status:'UNVERIFIED' };
  const persistence={ demoOrderJournal:async()=>[],getDemoBaselineCandidate:async()=>baseline,saveDemoAccountingCheckpoint:vi.fn(async()=>false) };
  const executor={inspectAccountIdentity:async()=>({status:'confirmed' as const,identity}),collectOrderEvidence:vi.fn(),collectFillHistory:vi.fn(),collectAccountBalances:async()=>({status:'collected' as const,startedAt:now-1000,endedAt:now-900,balances:{USDT:100}}),collectAccountCoverage:async()=>({status:'covered' as const,billCount:0})};
  expect(await inspectDemoAccounting(persistence,executor)).toMatchObject({status:'unavailable',reason:'checkpoint_changed_retry'});
});
