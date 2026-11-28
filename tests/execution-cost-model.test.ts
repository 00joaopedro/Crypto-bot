import { describe,expect,it } from 'vitest';
import { PaperTrader } from '../src/paper-trader.js';
import { exitPolicySchema } from '../src/exit-policy.js';
import { runPortfolioScenario } from '../src/portfolio-comparison.js';
import { comparisonSchema,scenarioCosts,assertComparisonCandidatesAndScenarios } from '../src/strategy-comparison.js';
import { paperDiagnosticTrade } from '../src/strategy-diagnostics.js';
const candle=(index:number,low=100)=>({timestamp:index*900_000,open:100,close:100,high:100,low,volume:10000});
const options={initialBalanceUsdt:100,tradeSizeUsdt:10,feeRate:.004,slippageRate:0,stopLossRate:.1,takeProfitRate:.1,entryFeeCurrency:'base' as const};
describe('account-conditioned Paper execution',()=>{
 it('deducts entry fees from quantity, not twice from cash or P&L, and survives restore',()=>{
  const t=new PaperTrader(options),opened=t.processCandle(candle(1),true);
  expect(opened.events[0]).toMatchObject({type:'OPENED',quantity:.0996,notionalUsdt:10,feeUsdt:.04,entryFeeCurrency:'base'});
  expect(t.exportState().cashUsdt).toBe(90);expect(opened.snapshot.unrealizedPnlUsdt).toBeCloseTo(-.07984);
  const restored=new PaperTrader(options,t.exportState());
  const closed=restored.processCandle(candle(2),false,undefined,true).events[0]!;
  expect(closed.type).toBe('CLOSED');if(closed.type!=='CLOSED')return;
  expect(closed.netPnlUsdt).toBeCloseTo(-.07984);expect(closed.feesUsdt).toBeCloseTo(.07984);
  expect(restored.exportState().cashUsdt).toBeCloseTo(99.92016);
  expect(paperDiagnosticTrade('BTC/USDT',closed)).toMatchObject({netPnlUsdt:closed.netPnlUsdt});
 });
 it('can spend the exact quote budget and refuses a net position below sell minimum',()=>{
  const t=new PaperTrader({...options,initialBalanceUsdt:10});expect(t.processCandle(candle(1),true).events).toHaveLength(1);expect(t.exportState().cashUsdt).toBe(0);
  const constrained=new PaperTrader({...options,executionConstraints:{minimumNotionalUsdt:0,minimumQuantity:.1,quantityStep:.001}});
  expect(constrained.processCandle(candle(1),true).events).toEqual([]);expect(constrained.exportState().cashUsdt).toBe(100);
 });
 it('keeps the fixed stop/target anchored to the pre-fill quote, without trailing or contrary exits',()=>{
  const t=new PaperTrader({...options,exitPolicy:exitPolicySchema.parse({mode:'fixed'}),slippageRate:.001});
  t.processCandle(candle(1),true,{stopLossRate:.01,takeProfitRate:.02,trailingStopRate:.005,referencePrice:100});
  expect(t.exportState().position).toMatchObject({stopLossPrice:99,takeProfitPrice:102});
  expect(t.exportState().position).not.toHaveProperty('trailingStopPrice');
  expect(t.processCandle(candle(2),false,undefined,true).events).toEqual([]);
  expect(t.processCandle(candle(3,98),false).events[0]).toMatchObject({reason:'STOP_LOSS',exitPrice:99*(1-.001)});
 });
 it('preserves legacy quote fee positions when restored under a different new-entry option',()=>{
  const old=new PaperTrader({...options,entryFeeCurrency:'quote'});old.processCandle(candle(1),true);
  const restored=new PaperTrader(options,old.exportState());const closed=restored.processCandle(candle(2),false,undefined,true).events[0]!;
  expect(closed).toMatchObject({netPnlUsdt:expect.closeTo(-.08)});expect(restored.exportState().cashUsdt).toBeCloseTo(99.92);
 });
});
const constraints={minimumNotionalUsdt:0,minimumQuantity:.001,quantityStep:.001};
const instruments=['BTC/USDT','ETH/USDT'].map(symbol=>({symbol,constraints,candles:[0,1,2,3].map(i=>candle(i))}));
const parameters={stopLossRate:.01,takeProfitRate:.02,minimumSignalScore:5,executionDelayCandles:1};
const scenario={name:'standard',feeRate:.001,slippageRate:0,spreadRate:0,assumedDepthUsdt:1000,maxParticipationRate:1,symbolCosts:{'BTC/USDT':{feeRate:.004,slippageRate:0,spreadRate:0,entryFeeCurrency:'base' as const},'ETH/USDT':{feeRate:.002,slippageRate:0,spreadRate:0,entryFeeCurrency:'base' as const}}};
const limits={maxConcurrentPositions:2,maxExposureRate:1,maxAltExposureRate:1};
describe('per-instrument portfolio costs',()=>{
 it('uses each fee for entry quantity, shared cash and mark-to-market instead of the global fee',()=>{
  const result=runPortfolioScenario(instruments,new Map([['BTC/USDT',[,8]],['ETH/USDT',[,7]]]),1,parameters,scenario,limits,100,10);
  expect(result.cashUsdt).toBe(80);expect(result.finalEquityUsdt).toBeCloseTo(99.8802);
  expect(result.perSymbol[0]!.openPosition!.quantity).toBe(.0996);expect(result.perSymbol[1]!.openPosition!.quantity).toBeCloseTo(.0998);
  expect(result.perSymbol[0]!.executionCosts).toMatchObject({feeRate:.004});
 });
 it('requires complete coverage and rejects a stress that secretly lowers one symbol fee',()=>{
  expect(()=>scenarioCosts({...scenario,symbolCosts:{'BTC/USDT':scenario.symbolCosts['BTC/USDT']}},'ETH/USDT')).toThrow('Missing execution costs');
  const stress={...scenario,name:'stress',feeRate:.008,symbolCosts:{...scenario.symbolCosts,'BTC/USDT':{...scenario.symbolCosts['BTC/USDT'],feeRate:.003}}};
  const input=comparisonSchema.parse({symbol:'BTC/USDT',dataSource:'fixture',trainCandles:100,testCandles:5,initialBalanceUsdt:100,tradeSizeUsdt:10,constraints,baseline:parameters,alternatives:[{name:'other',parameters}],scenarios:[scenario,stress]});
  expect(()=>assertComparisonCandidatesAndScenarios(input)).toThrow('adverse');
 });
 it('rejects an entry that becomes unsellable after a base fee before reserving cash',()=>{
  const bad=instruments.map(i=>({...i,constraints:{...constraints,minimumQuantity:.1}}));
  const result=runPortfolioScenario(bad,new Map([['BTC/USDT',[,8]],['ETH/USDT',[,7]]]),1,parameters,scenario,limits,100,10);
  expect(result.openPositions).toBe(0);expect(result.cashUsdt).toBe(100);expect(result.perSymbol[0]!.rejected).toEqual({minimum:1});
 });
});

it('uses only the runtime ATR candle window when preparing the fixed entry levels',()=>{
 const series=(old:number)=>Array.from({length:150},(_,i)=>i<49?{...candle(i),open:old,high:old,low:old,close:old}:candle(i,i===149?98:100));
 const run=(old:number)=>runPortfolioScenario(instruments.map(i=>({...i,candles:series(old)})),new Map([['BTC/USDT',Array.from({length:150},(_,i)=>i===148?8:undefined)]]),100,{...parameters,exitPolicy:exitPolicySchema.parse({mode:'fixed'})},scenario,limits,100,10,undefined,undefined,100);
 const first=run(100),changed=run(1000);
 expect(first.closedTradeLedger[0]).toMatchObject({reason:'STOP_LOSS',exitPrice:99});
 expect(changed.closedTradeLedger).toEqual(first.closedTradeLedger);
});
it('restores a fee-free reference position without inventing an entry fee',()=>{
 const t=new PaperTrader({...options,feeRate:0});t.processCandle(candle(1),true);
 const restored=new PaperTrader({...options,feeRate:0},t.exportState());
 expect(restored.processCandle(candle(2),false,undefined,true).events[0]).toMatchObject({netPnlUsdt:0,feesUsdt:0});
});
