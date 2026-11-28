import { describe, expect, it, vi } from 'vitest';
import { calculateDemoLedger, type DemoFill } from '../src/demo-ledger.js';
import { accountForDemoEvidence } from '../src/demo-accounting-evidence.js';
import { inspectDemoAccounting } from '../src/demo-diagnostic.js';
import { inspectDemoResume } from '../src/demo-resume.js';
import { advanceDemoRisk } from '../src/demo-risk.js';

function fixture() {
  const origin=Date.now()-120_000;
  // The reported NEAR residue is reproducible from the earlier purchase and
  // its base fee. Quote proceeds here are a test scenario, not asserted live P&L.
  const buy: DemoFill={id:'buy-fill',orderId:'buy',symbol:'NEAR/USDT',side:'buy',timestamp:origin+1000,amount:3.49756137,costUsdt:10,fees:[{currency:'NEAR',cost:.01399024548}]};
  const sell: DemoFill={id:'sell-fill',orderId:'sell',symbol:'NEAR/USDT',side:'sell',timestamp:origin+2000,amount:3.483571115,costUsdt:9.4,fees:[{currency:'USDT',cost:.0376}]};
  const journal=[{orderId:'buy',clientOrderId:'CB',symbol:buy.symbol,attachedAlgoClientId:'AP'}];
  const buys=[{id:'buy',clientOrderId:'CB',symbol:buy.symbol,side:'buy' as const,attachedAlgoClientIds:['AP'],filled:buy.amount,terminal:true}];
  const sells=[{id:'sell',clientOrderId:null,symbol:sell.symbol,side:'sell' as const,filled:sell.amount,terminal:true}];
  const protections=[{algoClientId:'AP',symbol:buy.symbol,side:'sell' as const,spawnedOrderIds:['sell']}];
  const fills=[buy,sell];
  const balances={USDT:4999.3624,NEAR:9.52e-9};
  const input={journalComplete:true,historyComplete:true,positionsReconciled:true,baseline:{confirmed:true,timestamp:origin,balances:{USDT:5000}},positionBalances:balances,positionBalancesTimestamp:origin+3000,coverageStart:origin,coverageEnd:origin+3000,journal,buys,sells,protections,fills};
  return {origin,buy,sell,fills,balances,input};
}

describe('decimal Demo reconciliation',()=>{
  it('covers the reported NEAR comparison and eliminates decimal cancellation without raising balance tolerance',()=>{
    const s=fixture();
    const legacy=s.buy.amount-s.buy.fees[0]!.cost-s.sell.amount;
    const reportedExpected=9.519999677465307e-9;
    expect(Math.abs(reportedExpected-s.balances.NEAR)).toBeGreaterThan(s.balances.NEAR*1e-8);
    expect(legacy).not.toBe(s.balances.NEAR);
    expect(Math.abs(legacy-s.balances.NEAR)).toBeGreaterThan(s.balances.NEAR*1e-8);
    const result=accountForDemoEvidence(s.input);
    expect(result).toMatchObject({status:'confirmed',positions:{'NEAR/USDT':{quantity:9.52e-9}}});
    if(result.status==='confirmed'){
      expect(result.positions['NEAR/USDT']!.costUsdt).toBeGreaterThan(0);
      expect(result.closedTrades).toEqual([]); // Real dust is still inventory.
      expect(JSON.parse(JSON.stringify(result))).toEqual(result); // No bigint in persistent output.
    }
  });
  it('still blocks missing, wiped or changed dust, cash discrepancies and unowned movements',()=>{
    const s=fixture();
    for(const NEAR of [0,9.53e-9,1e-8])expect(accountForDemoEvidence({...s.input,positionBalances:{...s.balances,NEAR}})).toMatchObject({reason:'position_balance_mismatch'});
    expect(accountForDemoEvidence({...s.input,positionBalances:{USDT:s.balances.USDT}})).toMatchObject({reason:'position_balance_missing'});
    expect(accountForDemoEvidence({...s.input,positionBalances:{...s.balances,USDT:s.balances.USDT+.01}})).toMatchObject({reason:'quote_balance_mismatch'});
    expect(accountForDemoEvidence({...s.input,positionBalances:{...s.balances,ETH:1}})).toMatchObject({reason:'unattributed_position_balance'});
    expect(accountForDemoEvidence({...s.input,fills:[s.buy]})).toMatchObject({reason:'order_fill_total_mismatch'});
  });
  it('recovers an existing float-era checkpoint, confirms risk and safely authorizes resume without resetting the cycle',async()=>{
    const s=fixture(),identity={uid:'test',mainUid:'test'};
    const baseline={observedAt:new Date(s.origin),balances:{USDT:5000},evidence:{startedAt:s.origin-100,accountIdentity:identity},status:'UNVERIFIED'};
    const checkpoint={...baseline,observedAt:new Date(s.origin+1500),balances:{USDT:4990,NEAR:3.48357112452},realizedPnlOffset:0,evidence:{...baseline.evidence,startedAt:s.origin+1400,ledgerCarry:{from:s.origin,balances:baseline.balances,pnlOffset:0,fills:[s.buy]}}};
    const store={getDemoBaselineCandidate:async()=>baseline,getDemoAccountingCheckpoint:async()=>checkpoint,demoOrderJournal:async()=>[{created_at:new Date(s.origin+500),client_order_id:'CB',symbol:'NEAR/USDT',status:'PLACED',attached_algo_client_id:'AP',result:{orderId:'buy'}}],saveDemoAccountingCheckpoint:vi.fn(async (_input: unknown)=>true),observeDemoRisk:vi.fn(async(_key:string,equity:number,at:number)=>advanceDemoRisk(null,equity,at))};
    const executor={inspectAccountIdentity:async()=>({status:'confirmed' as const,identity}),inspectTradingPermission:async()=>({status:'available' as const,trading:true}),
      collectAccountCoverage:vi.fn(async()=>({status:'covered' as const,billCount:1})),collectAccountBalances:async()=>({status:'collected' as const,startedAt:Date.now()-10,endedAt:Date.now(),balances:s.balances}),
      collectFillHistory:async()=>({status:'collected' as const,fills:[s.sell],from:s.origin+1500,to:Date.now()}),
      collectOrderEvidence:async()=>({status:'collected' as const,buys:s.input.buys,sells:s.input.sells,protections:s.input.protections,orders:[...s.input.buys,...s.input.sells].map(o=>({id:o.id,symbol:o.symbol,side:o.side,filled:o.filled,terminal:true,ownershipConfirmed:false})),protectionStates:{AP:'effective'}}),
      inspectExitProtection:async()=>({status:'closed' as const}),getAccountSnapshot:async()=>({quoteCurrency:'USDT',quoteFree:s.balances.USDT,totalUsdt:s.balances.USDT,equityUsdt:5000,unvaluedAssets:[],assetUnitValuesUsdt:{NEAR:3},updatedAt:new Date().toISOString()}),
    };
    const limits={botBudgetUsdt:5000,maxDailyLoss:.03,maxDrawdown:.1,inspectAccounting:()=>inspectDemoAccounting(store,executor)};
    expect(await inspectDemoResume(store,executor,limits)).toEqual({status:'safe'});
    expect(store.observeDemoRisk).toHaveBeenCalledTimes(1);
    const saved=store.saveDemoAccountingCheckpoint.mock.calls[0]![0] as any;
    expect(saved.evidence.ledgerCarry.fills).toHaveLength(2);
    expect(saved.balances.NEAR).toBe(9.52e-9);
    executor.collectAccountCoverage.mockResolvedValue({status:'unavailable',reason:'unattributed_account_bill'} as never);
    expect(await inspectDemoResume(store,executor,limits)).toMatchObject({status:'blocked',attributionReason:'unattributed_account_bill'});
    expect(store.observeDemoRisk).toHaveBeenCalledTimes(1);
  });
  it('keeps decimal quantities exact through split fills, base fees and final closure',()=>{
    const s=fixture();
    const split=[s.buy,{...s.sell,amount:2,costUsdt:5,id:'part1',timestamp:s.sell.timestamp}, {...s.sell,amount:1.483571115,costUsdt:4.4,id:'part2',timestamp:s.sell.timestamp+1}];
    expect(calculateDemoLedger(split,true)).toMatchObject({status:'confirmed',positions:{'NEAR/USDT':{quantity:9.52e-9}}});
    expect(calculateDemoLedger([...split,{...s.sell,id:'last',timestamp:s.sell.timestamp+2,amount:9.52e-9,costUsdt:3e-8,fees:[{currency:'USDT',cost:0}]}],true)).toMatchObject({status:'confirmed',closedTrades:[{buyOrderId:'buy'}],positions:{'NEAR/USDT':{quantity:0,costUsdt:0}}});
    expect(calculateDemoLedger([s.buy,{...s.sell,amount:3.483571124520001}],true)).toMatchObject({reason:'unmatched_sell_or_missing_history'});
  });
  it('does not discard a genuine decimal remainder merely because it is smaller than a machine epsilon of the original lot',()=>{
    const s=fixture();
    expect(calculateDemoLedger([{...s.buy,amount:1,fees:[{currency:'USDT',cost:0}]},{...s.sell,amount:.9999999999999999}],true)).toMatchObject({status:'confirmed',closedTrades:[],positions:{'NEAR/USDT':{quantity:1e-16}}});
  });
  it.each([0,6,8,12,18,24])('preserves one exact unit across quantity scales (10^-%i)',scale=>{
    const s=fixture();
    const buy={...s.buy,amount:Number('123456789e-'+scale),fees:[{currency:'NEAR',cost:Number('123456e-'+scale)}]};
    const sell={...s.sell,amount:Number('123333332e-'+scale)};
    expect(calculateDemoLedger([buy,sell],true)).toMatchObject({status:'confirmed',closedTrades:[],positions:{'NEAR/USDT':{quantity:Number('1e-'+scale)}}});
  });
  it('reconciles an exactly spent USDT balance without a negative binary residue',()=>{
    const s=fixture();
    const buy={...s.input.buys[0]!,filled:2};
    const fills=[{...s.buy,amount:1,costUsdt:.1,fees:[{currency:'USDT',cost:0}]},{...s.buy,id:'buy-part2',timestamp:s.buy.timestamp+1,amount:1,costUsdt:.2,fees:[{currency:'USDT',cost:0}]}];
    expect(.3-.1-.2).toBeLessThan(0);
    expect(accountForDemoEvidence({...s.input,baseline:{...s.input.baseline,balances:{USDT:.3}},buys:[buy],sells:[],protections:[{...s.input.protections[0]!,spawnedOrderIds:[]}],fills,positionBalances:{NEAR:2,USDT:0}})).toMatchObject({status:'confirmed',positions:{'NEAR/USDT':{quantity:2}}});
  });
});
