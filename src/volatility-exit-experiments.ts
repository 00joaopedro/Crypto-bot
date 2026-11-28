import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { semanticHash, type CostExperimentRow } from "./cost-experiments.js";
import { netActivationPrice } from "./research-trailing.js";
import { initialExitRates } from "./exit-policy.js";
import { comparisonSlippage, scenarioCosts } from "./strategy-comparison.js";
import { compareUniverseSizes, universeStudySchema, type UniverseDataset, type UniverseStudy, type VolatilityExitResearch } from "./universe-comparison.js";
import type { DiagnosticTrade } from "./strategy-diagnostics.js";
export const VOLATILITY_EXIT_VARIANTS = ["reference", "atr-floor-0.75", "net-trailing-with-target", "net-trailing-no-target"] as const;
export const VOLATILITY_EXIT_RULES = { minimumAtrRate: 0.0075, netActivationRate: 0.012, trailingMultiplier: 1.5, activationBasis: "surviving_candle_close" } as const;
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const volatilityExitPlanSchema=z.object({protocol:z.literal("volatility-exit-development-v1"),referenceStudySha256:digest,sourceStudySha256:digest,
 sizes:z.tuple([z.literal(10),z.literal(30)]),variants:z.array(z.string()).length(4),minimumClosedTradesPerRun:z.literal(30),
 rules:z.object({minimumAtrRate:z.literal(.0075),netActivationRate:z.literal(.012),trailingMultiplier:z.literal(1.5),activationBasis:z.literal("surviving_candle_close")}).strict()
}).strict().refine(p=>isDeepStrictEqual(p.variants,VOLATILITY_EXIT_VARIANTS)&&isDeepStrictEqual(p.rules,VOLATILITY_EXIT_RULES),"Only predeclared volatility/exit alternatives are allowed");
export function volatilityExitStudies(rawReference:unknown,rawPlan:unknown){
 const reference=universeStudySchema.parse(rawReference),plan=volatilityExitPlanSchema.parse(rawPlan);
 if(semanticHash(reference)!==plan.referenceStudySha256)throw new Error("Financial reference hash mismatch");
 if(!isDeepStrictEqual(reference.sizes,plan.sizes)||reference.parameters.executionDelayCandles!==1||reference.parameters.exitPolicy?.mode!=="fixed"||reference.parameters.exitPolicy.breakeven||reference.scenarios.length!==2||reference.scenarios.some(s=>!s.symbolCosts))throw new Error("Frozen fixed-exit financial reference required");
 const variants=VOLATILITY_EXIT_VARIANTS.map(name=>{
   const trailing=name.startsWith("net-trailing-");
   const study=universeStudySchema.parse({...reference,parameters:{...reference.parameters,...(trailing?{exitPolicy:{...reference.parameters.exitPolicy,mode:"trailing_atr",trailingMultiplier:1.5}}:{})}});
   const research:VolatilityExitResearch|undefined=name==="reference"?undefined:name==="atr-floor-0.75"?{minimumAtrRate:.0075}:{trailing:{netActivationRate:.012,trailingMultiplier:1.5,retainFixedTarget:name==="net-trailing-with-target"}};
   return {name,study,research};
 });
 return {reference,plan,variants};
}
/** Ex-post geometry on closed reference trades, not attainable fills or promotion evidence. */
export function diagnoseFixedTargetReach(trades:DiagnosticTrade[],datasets:UniverseDataset[],study:UniverseStudy,scenario:UniverseStudy["scenarios"][number]){
 const assets=new Map(datasets.map(d=>[d.symbol,d]));
 const rows=trades.map(t=>{
   const d=assets.get(t.symbol),entry=d?.candles.findIndex(c=>c.timestamp===t.entryTimestamp),decision=d?.candles.findIndex(c=>c.timestamp===t.entryContext?.decisionTimestamp);
   if(!d||entry===undefined||entry<0||decision===undefined||decision<0||decision>=entry)throw new Error("Closed trade clock does not match reference");
   const costs=scenarioCosts(scenario,t.symbol),slip=comparisonSlippage(costs),cashCost=t.entryPrice*t.quantity*(costs.entryFeeCurrency==="base"?1/(1-costs.feeRate):1+costs.feeRate);
   const history=d.candles.slice(Math.max(0,decision+1-study.candleLimit),decision+1);
   const rates=initialExitRates(history,history.at(-1)!.close,study.parameters.exitPolicy!,study.parameters);
   const fixedTarget=d.candles[entry]!.open*(1+costs.spreadRate/2)*(1+rates.takeProfitRate);
   const activationPrice=netActivationPrice(cashCost,t.quantity,costs.feeRate,slip,.012);
   return {targetBelowActivation:fixedTarget<activationPrice,exitedAtFixedTarget:t.reason==="TAKE_PROFIT",requiredPriceRiseFromFillRate:activationPrice/t.entryPrice-1,netReturnAtTargetRate:fixedTarget*t.quantity*(1-costs.feeRate)*(1-slip)/cashCost-1};
 });
 const range=(values:number[])=>values.length?{minimum:Math.min(...values),maximum:Math.max(...values),mean:values.reduce((a,b)=>a+b,0)/values.length}:null;
 return {closedReferenceTrades:rows.length,fixedTargetsBelowNetActivation:rows.filter(r=>r.targetBelowActivation).length,takeProfitsBelowNetActivation:rows.filter(r=>r.targetBelowActivation&&r.exitedAtFixedTarget).length,requiredPriceRiseFromFillRate:range(rows.map(r=>r.requiredPriceRiseFromFillRate)),netReturnAtFixedTargetRate:range(rows.map(r=>r.netReturnAtTargetRate))};
}
export function screenVolatilityExitExperiments(rows: CostExperimentRow[], scenarios: string[]) {
  const expected = VOLATILITY_EXIT_VARIANTS.flatMap(v => [10,30].flatMap(size => scenarios.map(s => `${v}:${size}:${s}`)));
  const keys = rows.map(r => `${r.variant}:${r.size}:${r.scenario}`);
  if (scenarios.length !== 2 || new Set(scenarios).size !== 2 || keys.length !== 16 || new Set(keys).size !== 16 || expected.some(k => !keys.includes(k))) throw new Error("Incomplete volatility/exit matrix");
  const candidates = VOLATILITY_EXIT_VARIANTS.map(variant => {
    const runs = rows.filter(r => r.variant === variant);
    const reasons = runs.flatMap(r => {
      if (![r.netReturnUsdt,r.realizedPnlUsdt,r.maxDrawdownUsdt,r.realizedPnlWithoutTop3Usdt].every(Number.isFinite) || !Number.isInteger(r.closedTrades) || r.closedTrades < 0 || r.blocks.length !== 2 || r.blocks.some(b => !Number.isFinite(b.netReturnUsdt) || !Number.isInteger(b.closedTrades) || b.closedTrades < 0)) throw new Error("Invalid volatility/exit metrics");
      const k = `${r.size}:${r.scenario}`;
      return [
        ...(r.netReturnUsdt <= 0 || r.realizedPnlUsdt <= 0 ? [`${k}:nonpositive_result`] : []),
        ...(r.closedTrades < 30 ? [`${k}:small_sample`] : []),
        ...(r.profitFactor === null || !Number.isFinite(r.profitFactor) || r.profitFactor <= 1 ? [`${k}:no_positive_closed_trade_edge`] : []),
        ...(r.expectancyUsdt === null || !Number.isFinite(r.expectancyUsdt) || r.expectancyUsdt <= 0 ? [`${k}:nonpositive_expectancy`] : []),
        ...(r.blocks.some(b => b.netReturnUsdt <= 0 || b.closedTrades < 15) ? [`${k}:weak_development_block`] : []),
        ...(r.realizedPnlWithoutTop3Usdt <= 0 ? [`${k}:dependent_on_top_three`] : []),
      ];
    });
    return { variant, passesDevelopmentScreen: reasons.length === 0, reasons };
  });
  return { status: candidates.some(c => c.passesDevelopmentScreen) ? "independent_protocol_required" : "blocked_no_eligible_candidate", candidates,
    holdoutExecuted: false, configurationPromoted: false, realMoneyApproved: false };
}
export function runVolatilityExitExperiments(datasets:UniverseDataset[],rawReference:unknown,rawPlan:unknown){
 const prepared=volatilityExitStudies(rawReference,rawPlan),rows:CostExperimentRow[]=[],exitDiagnostics:unknown[]=[];
 const reports=prepared.variants.map(v=>{
   const report=compareUniverseSizes(datasets,v.study,"trend",undefined,undefined,v.research);
   for(const u of report.results)for(const s of u.scenarios){
     const r=s.result;
     const d=r.researchExitDiagnostics;
     if(d&&(d.opened!==r.closedTrades+r.openPositions||d.closedBeforeActivation+d.closedAfterActivation!==r.closedTrades||d.activatedPositions>d.opened||d.closedAfterActivation>d.activatedPositions))throw new Error("Research exit counters do not reconcile");
     rows.push({variant:v.name,size:u.size,scenario:s.scenario.name,netReturnUsdt:r.netReturnUsdt,realizedPnlUsdt:r.realizedPnlUsdt,profitFactor:r.profitFactor,closedTrades:r.closedTrades,expectancyUsdt:r.expectancyUsdt,maxDrawdownUsdt:r.maxDrawdownUsdt,recoveryFactor:r.recoveryFactor,top3TradesProfitSharePercent:r.top3TradesProfitSharePercent,realizedPnlWithoutTop3Usdt:r.realizedPnlWithoutTop3Usdt,blocks:r.blocks!.map(b=>({netReturnUsdt:b.netReturnUsdt,closedTrades:b.closedTrades,profitFactor:b.profitFactor}))});
     exitDiagnostics.push({variant:v.name,size:u.size,scenario:s.scenario.name,openPositions:r.openPositions,feesUsdt:r.feesUsdt,closedTradesFeesUsdt:r.diagnostics.summary.feesUsdt,realizedPnlUsdt:r.realizedPnlUsdt,beforeFeesRealizedPnlUsdt:r.diagnostics.summary.beforeFeesPnlUsdt,exitReasons:r.diagnostics.byExitReason.map(b=>({reason:b.key,trades:b.closedTrades,realizedPnlUsdt:b.realizedPnlUsdt})),...(v.name==="reference"?{fixedTargetGeometry:diagnoseFixedTargetReach(r.closedTradeLedger,datasets,prepared.reference,s.scenario)}:{}),...(r.researchExitDiagnostics?{trailing:r.researchExitDiagnostics}:{})});
   }
   return {variant:v.name,studySha256:semanticHash(v.study),research:v.research??null,report};
 });
 const comparisons=rows.filter(r=>r.variant!=="reference").map(r=>{
 const b=rows.find(b=>b.variant==="reference"&&b.size===r.size&&b.scenario===r.scenario)!;
 return {variant:r.variant,size:r.size,scenario:r.scenario,netPnlDeltaUsdt:r.netReturnUsdt-b.netReturnUsdt,closedTradesDelta:r.closedTrades-b.closedTrades,profitFactorDelta:r.profitFactor===null||b.profitFactor===null?null:r.profitFactor-b.profitFactor,expectancyDeltaUsdt:r.expectancyUsdt===null||b.expectancyUsdt===null?null:r.expectancyUsdt-b.expectancyUsdt};
 });
 return {...prepared,rows,reports,comparisons,exitDiagnostics,readiness:screenVolatilityExitExperiments(rows,prepared.reference.scenarios.map(s=>s.name))};
}
