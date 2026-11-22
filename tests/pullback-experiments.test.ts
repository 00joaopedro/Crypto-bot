import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PULLBACK_VARIANTS, pullbackPlanSchema, screenPullbackExperiments, runPullbackExperiments } from "../src/pullback-experiments.js";
import { semanticHash, type CostExperimentRow } from "../src/cost-experiments.js";
import { universeStudySchema } from "../src/universe-comparison.js";
const plan=JSON.parse(readFileSync(new URL('../examples/pullback-experiments.plan.json',import.meta.url),'utf8'));
const reference=JSON.parse(readFileSync(new URL('../examples/pullback-reference.study.json',import.meta.url),'utf8'));
const good=():CostExperimentRow[]=>PULLBACK_VARIANTS.flatMap(variant=>[10,30].flatMap(size=>['a','b'].map(scenario=>({variant,size,scenario,netReturnUsdt:10,realizedPnlUsdt:10,profitFactor:2,closedTrades:40,expectancyUsdt:.25,maxDrawdownUsdt:3,recoveryFactor:10/3,top3TradesProfitSharePercent:20,realizedPnlWithoutTop3Usdt:7,blocks:[{netReturnUsdt:4,closedTrades:20,profitFactor:2},{netReturnUsdt:6,closedTrades:20,profitFactor:2}]}))));
it('freezes exactly four variants and the financial reference, rejects altered thresholds/costs',()=>{
  expect(pullbackPlanSchema.parse(plan).variants).toEqual(PULLBACK_VARIANTS);
  expect(semanticHash(universeStudySchema.parse(reference))).toBe(plan.referenceStudySha256);
  expect(()=>pullbackPlanSchema.parse({...plan,rules:{...plan.rules,maximumRsi:60}})).toThrow();
  expect(()=>pullbackPlanSchema.parse({...plan,variants:[...plan.variants].reverse()})).toThrow(/predeclared/);
  expect(()=>runPullbackExperiments([],{...reference,tradeSizeUsdt:20},plan)).toThrow(/hash mismatch/);
});
it('rejects missing and duplicated alternatives and nonfinite metrics',()=>{
  expect(()=>screenPullbackExperiments(good().slice(1),['a','b'])).toThrow(/matrix/);
  const duplicate=good();duplicate[1]=duplicate[0]!;expect(()=>screenPullbackExperiments(duplicate,['a','b'])).toThrow(/matrix/);
  const invalid=good();invalid[0]!.netReturnUsdt=NaN;expect(()=>screenPullbackExperiments(invalid,['a','b'])).toThrow(/metrics/);
});
it('blocks lower losses, fewer trades, negative expectancy, weak blocks and concentrated profit',()=>{
  for(const change of [(r:CostExperimentRow)=>{r.netReturnUsdt=-.01;},(r:CostExperimentRow)=>{r.closedTrades=29;},(r:CostExperimentRow)=>{r.expectancyUsdt=-.01;},(r:CostExperimentRow)=>{r.profitFactor=.99;},(r:CostExperimentRow)=>{r.blocks[1]!.netReturnUsdt=-1;},(r:CostExperimentRow)=>{r.realizedPnlWithoutTop3Usdt=-1;}]){
    const rows=good();rows.forEach(change);expect(screenPullbackExperiments(rows,['a','b']).status).toBe('blocked_no_eligible_candidate');
  }
});
it('synthetic passing evidence only requests independent protocol, never promotes or approves real money',()=>{
  expect(screenPullbackExperiments(good(),['a','b'])).toMatchObject({status:'independent_protocol_required',holdoutExecuted:false,configurationPromoted:false,realMoneyApproved:false});
});
