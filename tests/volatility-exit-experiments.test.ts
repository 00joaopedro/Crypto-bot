import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { VOLATILITY_EXIT_VARIANTS, volatilityExitPlanSchema, screenVolatilityExitExperiments, runVolatilityExitExperiments, volatilityExitStudies, diagnoseFixedTargetReach } from "../src/volatility-exit-experiments.js";
import { semanticHash, type CostExperimentRow } from "../src/cost-experiments.js";
import { universeStudySchema } from "../src/universe-comparison.js";
const plan=JSON.parse(readFileSync(new URL('../examples/volatility-exit-experiments.plan.json',import.meta.url),'utf8'));
const reference=JSON.parse(readFileSync(new URL('../examples/pullback-reference.study.json',import.meta.url),'utf8'));
const good=():CostExperimentRow[]=>VOLATILITY_EXIT_VARIANTS.flatMap(variant=>[10,30].flatMap(size=>['a','b'].map(scenario=>({variant,size,scenario,netReturnUsdt:10,realizedPnlUsdt:10,profitFactor:2,closedTrades:40,expectancyUsdt:.25,maxDrawdownUsdt:3,recoveryFactor:10/3,top3TradesProfitSharePercent:20,realizedPnlWithoutTop3Usdt:7,blocks:[{netReturnUsdt:4,closedTrades:20,profitFactor:2},{netReturnUsdt:6,closedTrades:20,profitFactor:2}]}))));
it('freezes exactly four variants and the financial reference, rejects altered thresholds/costs',()=>{
  expect(volatilityExitPlanSchema.parse(plan).variants).toEqual(VOLATILITY_EXIT_VARIANTS);
  expect(semanticHash(universeStudySchema.parse(reference))).toBe(plan.referenceStudySha256);
  expect(()=>volatilityExitPlanSchema.parse({...plan,rules:{...plan.rules,minimumAtrRate:.008}})).toThrow();
  expect(()=>volatilityExitPlanSchema.parse({...plan,variants:[...plan.variants].reverse()})).toThrow(/predeclared/);
  expect(()=>runVolatilityExitExperiments([],{...reference,tradeSizeUsdt:20},plan)).toThrow(/hash mismatch/);
});
it('rejects missing and duplicated alternatives and nonfinite metrics',()=>{
  expect(()=>screenVolatilityExitExperiments(good().slice(1),['a','b'])).toThrow(/matrix/);
  const duplicate=good();duplicate[1]=duplicate[0]!;expect(()=>screenVolatilityExitExperiments(duplicate,['a','b'])).toThrow(/matrix/);
  const invalid=good();invalid[0]!.netReturnUsdt=NaN;expect(()=>screenVolatilityExitExperiments(invalid,['a','b'])).toThrow(/metrics/);
});
it('blocks lower losses, fewer trades, negative expectancy, weak blocks and concentrated profit',()=>{
  for(const change of [(r:CostExperimentRow)=>{r.netReturnUsdt=-.01;},(r:CostExperimentRow)=>{r.closedTrades=29;},(r:CostExperimentRow)=>{r.expectancyUsdt=-.01;},(r:CostExperimentRow)=>{r.profitFactor=.99;},(r:CostExperimentRow)=>{r.blocks[1]!.netReturnUsdt=-1;},(r:CostExperimentRow)=>{r.realizedPnlWithoutTop3Usdt=-1;}]){
    const rows=good();rows.forEach(change);expect(screenVolatilityExitExperiments(rows,['a','b']).status).toBe('blocked_no_eligible_candidate');
  }
});
it('synthetic passing evidence only requests independent protocol, never promotes or approves real money',()=>{
  expect(screenVolatilityExitExperiments(good(),['a','b'])).toMatchObject({status:'independent_protocol_required',holdoutExecuted:false,configurationPromoted:false,realMoneyApproved:false});
});

it('isolates the ATR floor and exit policies without mixing pullback or changing initial risk/costs',()=>{
 const variants=volatilityExitStudies(reference,plan).variants;
 expect(variants[0]!.research).toBeUndefined();expect(variants[1]!.research).toEqual({minimumAtrRate:.0075});
 expect(variants[1]!.study).toEqual(variants[0]!.study);
 for(const v of variants){expect(v.study.scenarios).toEqual(reference.scenarios);expect(v.study.portfolio).toEqual(reference.portfolio);expect(v.study.initialBalanceUsdt).toEqual(reference.initialBalanceUsdt);expect(v.study.tradeSizeUsdt).toEqual(reference.tradeSizeUsdt);expect(v.study.parameters.exitPolicy!.stopMultiplier).toBe(reference.parameters.exitPolicy.stopMultiplier);expect(v.study.parameters.exitPolicy!.maxStopRate).toBe(reference.parameters.exitPolicy.maxStopRate);expect(v.study.parameters.exitPolicy!.targetMultiplier).toBe(reference.parameters.exitPolicy.targetMultiplier);}
 expect(variants[2]!.research).toEqual({trailing:{netActivationRate:.012,trailingMultiplier:1.5,retainFixedTarget:true}});
 expect(variants[3]!.research).toEqual({trailing:{netActivationRate:.012,trailingMultiplier:1.5,retainFixedTarget:false}});
});

it('measures fixed targets below net activation without mistaking a raw price target for net profit',()=>{
 const study=universeStudySchema.parse(reference),scenario=study.scenarios[0]!;
 const candles=Array.from({length:22},(_,i)=>({timestamp:i*900000,open:100,high:100.1,low:99.9,close:100,volume:10000}));
 const costs=scenario.symbolCosts!['BTC/USDT']!,slip=(1+costs.slippageRate)*(1+costs.spreadRate/2)-1;
 const entryPrice=100*(1+slip),quantity=.996,cost=entryPrice,exitPrice=100*(1+costs.spreadRate/2)*1.006*(1-slip),netPnlUsdt=exitPrice*quantity*(1-costs.feeRate)-cost;
 const trade={symbol:'BTC/USDT',entryTimestamp:20*900000,exitTimestamp:21*900000,entryPrice,exitPrice,quantity,netPnlUsdt,feesUsdt:(exitPrice-entryPrice)*quantity-netPnlUsdt,reason:'TAKE_PROFIT' as const,entryContext:{decisionTimestamp:19*900000}};
 const dataset={symbol:'BTC/USDT',candles,quoteVolumesUsdt:[],constraints:{minimumNotionalUsdt:0,minimumQuantity:.001,quantityStep:.001}};
 const result=diagnoseFixedTargetReach([trade],[dataset],study,scenario);
 expect(result).toMatchObject({closedReferenceTrades:1,fixedTargetsBelowNetActivation:1,takeProfitsBelowNetActivation:1});
 expect(result.netReturnAtFixedTargetRate!.maximum).toBeLessThan(.012);expect(result.requiredPriceRiseFromFillRate!.minimum).toBeGreaterThan(.012);
 expect(()=>diagnoseFixedTargetReach([{...trade,entryContext:{decisionTimestamp:20*900000}}],[dataset],study,scenario)).toThrow(/clock/);
});
