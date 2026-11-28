import { describe,expect,it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { effectiveExecutionSnapshot } from '../src/execution-fidelity.js';
import { buildExecutionCostProfile,calibratedExecutionStudy } from '../src/execution-cost-profile.js';
import { readFileSync } from 'node:fs';
const at='2026-11-22T12:00:00.000Z';
const plan={fallbackFeeRate:.005,assumedSpreadRate:.0015,assumedSlippageRate:.001,stressMultiplier:2,sizes:[10,30]};
function diagnostic(){
 const snapshot=effectiveExecutionSnapshot(parseConfig({OKX_DEMO_BOT_BUDGET_USDT:'5000',MIN_SIGNAL_SCORE:'4'}),{symbol:'BTC/USDT',orderSizeUsdt:10,maxTrades:30,maxConcurrentPositions:30,intervalMinutes:15},undefined,undefined,{commitSha:'a'.repeat(40)});
 const order={section:'demo_orders',status:'PLACED',symbol:'ETH/USDT',client_order_id:'CBETH',created_at:at,updated_at:at,
 result:{clientOrderId:'CBETH',confirmed:true,orderStatus:'closed',side:'buy',filled:1,cost:100,average:100,quotedTakerFeeRate:.004,referencePrice:98,fees:[{currency:'ETH',cost:.004}]}};
 return {generatedAt:at,records:[order],executionFidelity:{snapshot,tradingTerms:{status:'confirmed',symbol:'BTC/USDT',observedAtUtc:at,takerFeeRate:.003,minimumQuantity:.0001,quantityStep:.0001}}};
}
const symbols=['BTC/USDT','ETH/USDT','SOL/USDT'];
describe('execution cost evidence',()=>{
 it('keeps pair fee evidence separate from explicit fallback and does not copy secrets',()=>{
  const input={...diagnostic(),credential:'DO_NOT_COPY'};const profile=buildExecutionCostProfile([input],plan,symbols);
  expect(profile.coverage).toMatchObject({feeEvidenced:2,feesAssumed:1,measuredBuyQuoteSymbols:0});
  expect(profile.profiles.find(p=>p.symbol==='ETH/USDT')).toMatchObject({feeRate:.004,entryFeeCurrency:'base',feeEvidence:'evidenced_maximum',quoteSamples:0});
  expect(profile.profiles.find(p=>p.symbol==='SOL/USDT')).toMatchObject({feeRate:.005,feeEvidence:'declared_fallback_assumption'});
  expect(JSON.stringify(profile)).not.toContain('DO_NOT_COPY');expect(profile.evidence.legacyQuoteReferences).toBe(1);
 });
 it('deduplicates terminal observations and rejects conflicting fee history',()=>{
  const d=diagnostic(),p=buildExecutionCostProfile([d,d],plan,symbols);
  expect(p.profiles.find(p=>p.symbol==='ETH/USDT')!.terminalFeeObservations).toBe(1);
  const conflict=diagnostic();conflict.records[0]!.result.fees[0]!.cost=.005;
  expect(()=>buildExecutionCostProfile([d,conflict],plan,symbols)).toThrow('Conflicting duplicate');
 });
 it('does not infer a measured slippage from legacy referencePrice, Paper trades or pending orders',()=>{
  const d=diagnostic();d.records[0]!.status='PENDING';
  const p=buildExecutionCostProfile([d],plan,symbols);
  expect(p.profiles.find(p=>p.symbol==='ETH/USDT')).toMatchObject({feeRate:.005,feeObservations:0,quoteSamples:0});
 });
 it('uses only attributable pre-fill Demo quotes and retains conservative spread/slippage floors',()=>{
  const d=diagnostic();const raw=d as any;
  raw.records[0].result.average=102;
  raw.records[0].result.entryExecutionEvidence={venue:'okx-demo',reference:'best_ask',bestBid:99,bestAsk:100,spreadRate:2/199,receivedAtUtc:'2026-11-22T11:59:59.000Z',bookTimestamp:null};
  const p=buildExecutionCostProfile([d],plan,symbols).profiles.find(p=>p.symbol==='ETH/USDT')!;
  expect(p.quoteSamples).toBe(1);expect(p.slippageRate).toBeCloseTo(.02);expect(p.spreadRate).toBeCloseTo(2/199);
  raw.records[0].result.entryExecutionEvidence.spreadRate=.001;
  expect(()=>buildExecutionCostProfile([d],plan,symbols)).toThrow('Invalid entry quote');
 });
 it('leaves unknown fee currencies unverified and refuses incompatible runtime or altered snapshot',()=>{
  const d=diagnostic();d.records[0]!.result.fees[0]!.currency='OKB';
  expect(buildExecutionCostProfile([d],plan,symbols).coverage.feesAssumed).toBe(2);
  const bad=diagnostic();bad.executionFidelity.snapshot.settings.demoOrderCeilingUsdt=20;
  expect(()=>buildExecutionCostProfile([bad],plan,symbols)).toThrow('hash mismatch');
 });
 it('reconstructs a fixed ATR reference with runtime sizing and explicit stressed pair costs',()=>{
  const p=buildExecutionCostProfile([diagnostic()],plan,symbols);
  const study=calibratedExecutionStudy(p,JSON.parse(readFileSync(new URL('../examples/universe-validation.study.json',import.meta.url),'utf8')));
  expect(study).toMatchObject({initialBalanceUsdt:5000,tradeSizeUsdt:10,portfolio:{maxConcurrentPositions:30},parameters:{minimumSignalScore:4,btcRegimeFilter:false,exitPolicy:{mode:'fixed',breakeven:false}}});
  expect(study.scenarios[0]!.symbolCosts!['SOL/USDT']!.feeRate).toBe(.005);
  expect(study.scenarios[1]!.symbolCosts!['ETH/USDT']!.feeRate).toBe(.008);
  expect(p.snapshot.exitPolicy).toBeNull(); // Does not alter the captured/live policy.
 });
});

it('consumes scoped batch quotes without treating pending pairs as confirmed',()=>{
  const d=diagnostic() as any;
  d.executionFidelity.tradingTermsBySymbol=[{symbol:'SOL/USDT',terms:{...d.executionFidelity.tradingTerms,symbol:'SOL/USDT',takerFeeRate:.006}},{symbol:'XRP/USDT',terms:{status:'unavailable',reason:'query_pending'}}];
  const p=buildExecutionCostProfile([d],plan,[...symbols,'XRP/USDT']);
  expect(p.profiles.find(p=>p.symbol==='SOL/USDT')).toMatchObject({feeRate:.006,feeEvidence:'evidenced_maximum'});
  expect(p.profiles.find(p=>p.symbol==='XRP/USDT')).toMatchObject({feeRate:.005,feeEvidence:'declared_fallback_assumption'});
  d.executionFidelity.tradingTermsBySymbol[0].symbol='BTC/USDT';
  expect(()=>buildExecutionCostProfile([d],plan,symbols)).toThrow('Quote symbol mismatch');
});

it('preserves an explicit fixed runtime ATR policy instead of substituting configuration defaults',()=>{
  const d=diagnostic();
  const policy={mode:'fixed' as const,breakeven:false,atrPeriod:20,stopMultiplier:2,targetMultiplier:4,minStopRate:.01,maxStopRate:.025,trailingMultiplier:2,activationRate:.02,exitFeeRate:.004,exitSlippageRate:.001};
  d.executionFidelity.snapshot=effectiveExecutionSnapshot(parseConfig({OKX_DEMO_BOT_BUDGET_USDT:'5000',MIN_SIGNAL_SCORE:'4',EXIT_MANAGEMENT_ENABLED:'true'}),{symbol:'BTC/USDT',orderSizeUsdt:10,maxTrades:30,maxConcurrentPositions:30,intervalMinutes:15},policy,undefined,{commitSha:'a'.repeat(40)});
  const p=buildExecutionCostProfile([d],plan,symbols);
  const study=calibratedExecutionStudy(p,JSON.parse(readFileSync(new URL('../examples/universe-validation.study.json',import.meta.url),'utf8')));
  expect(study.parameters.exitPolicy).toEqual(policy);
});
