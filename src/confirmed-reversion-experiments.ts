import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { semanticHash, type CostExperimentRow } from "./cost-experiments.js";
import { CONFIRMED_REVERSION_RULES } from "./confirmed-mean-reversion.js";
import { compareUniverseSizes, universeStudySchema, type UniverseDataset } from "./universe-comparison.js";
export const CONFIRMED_REVERSION_VARIANTS=["reference","confirmed-mean-reversion"] as const;
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const confirmedReversionPlanSchema=z.object({protocol:z.literal("confirmed-reversion-development-v1"),referenceStudySha256:digest,sourceStudySha256:digest,
 sizes:z.tuple([z.literal(10),z.literal(30)]),variants:z.array(z.string()).length(2),minimumClosedTradesPerRun:z.literal(30),
 rules:z.object({bandPeriod:z.literal(20),bandDeviations:z.literal(2),rsiPeriod:z.literal(7),maximumRsiExclusive:z.literal(25),expiryCandles:z.literal(4),downtrendEmaPeriod:z.literal(50),downtrendSlopeCandles:z.literal(4),target:z.literal("decision_sma20"),stop:z.literal("reference_initial_atr14"),costScreen:z.literal("positive_net_target_at_decision_and_entry")}).strict()
}).strict().refine(p=>isDeepStrictEqual(p.variants,CONFIRMED_REVERSION_VARIANTS)&&isDeepStrictEqual(p.rules,CONFIRMED_REVERSION_RULES),"Only predeclared confirmed-reversion alternatives are allowed");
export function confirmedReversionStudy(rawReference:unknown,rawPlan:unknown){
 const reference=universeStudySchema.parse(rawReference),plan=confirmedReversionPlanSchema.parse(rawPlan);
 if(semanticHash(reference)!==plan.referenceStudySha256)throw new Error("Financial reference hash mismatch");
 if(!isDeepStrictEqual(reference.sizes,plan.sizes)||reference.parameters.executionDelayCandles!==1||reference.parameters.exitPolicy?.mode!=="fixed"||reference.parameters.exitPolicy.breakeven||reference.scenarios.length!==2||reference.scenarios.some(s=>!s.symbolCosts))throw new Error("Frozen fixed-exit financial reference required");
 return {reference,plan};
}
export function screenConfirmedReversionExperiments(rows: CostExperimentRow[], scenarios: string[]) {
  const expected = CONFIRMED_REVERSION_VARIANTS.flatMap(v => [10,30].flatMap(size => scenarios.map(s => `${v}:${size}:${s}`)));
  const keys = rows.map(r => `${r.variant}:${r.size}:${r.scenario}`);
  if (scenarios.length !== 2 || new Set(scenarios).size !== 2 || keys.length !== 8 || new Set(keys).size !== 8 || expected.some(k => !keys.includes(k))) throw new Error("Incomplete confirmed reversion matrix");
  const candidates = CONFIRMED_REVERSION_VARIANTS.map(variant => {
    const runs = rows.filter(r => r.variant === variant);
    const reasons = runs.flatMap(r => {
      if (![r.netReturnUsdt,r.realizedPnlUsdt,r.maxDrawdownUsdt,r.realizedPnlWithoutTop3Usdt].every(Number.isFinite) || !Number.isInteger(r.closedTrades) || r.closedTrades < 0 || r.blocks.length !== 2 || r.blocks.some(b => !Number.isFinite(b.netReturnUsdt) || !Number.isInteger(b.closedTrades) || b.closedTrades < 0)) throw new Error("Invalid confirmed reversion metrics");
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
export function runConfirmedReversionExperiments(datasets:UniverseDataset[],rawReference:unknown,rawPlan:unknown){
 const prepared=confirmedReversionStudy(rawReference,rawPlan),rows:CostExperimentRow[]=[],diagnostics:unknown[]=[];
 const reports=CONFIRMED_REVERSION_VARIANTS.map(variant=>{
   const report=compareUniverseSizes(datasets,prepared.reference,variant==="reference"?"trend":"confirmed_mean_reversion");
   for(const u of report.results)for(const s of u.scenarios){
     const r=s.result;
     rows.push({variant,size:u.size,scenario:s.scenario.name,netReturnUsdt:r.netReturnUsdt,realizedPnlUsdt:r.realizedPnlUsdt,profitFactor:r.profitFactor,closedTrades:r.closedTrades,expectancyUsdt:r.expectancyUsdt,maxDrawdownUsdt:r.maxDrawdownUsdt,recoveryFactor:r.recoveryFactor,top3TradesProfitSharePercent:r.top3TradesProfitSharePercent,realizedPnlWithoutTop3Usdt:r.realizedPnlWithoutTop3Usdt,blocks:r.blocks!.map(b=>({netReturnUsdt:b.netReturnUsdt,closedTrades:b.closedTrades,profitFactor:b.profitFactor}))});
     diagnostics.push({variant,size:u.size,scenario:s.scenario.name,openPositions:r.openPositions,feesUsdt:r.feesUsdt,closedTradesFeesUsdt:r.diagnostics.summary.feesUsdt,beforeFeesRealizedPnlUsdt:r.diagnostics.summary.beforeFeesPnlUsdt,entryTargetCostRejections:r.perSymbol.reduce((n,a)=>n+(a.rejected.targetCosts??0),0),exitReasons:r.diagnostics.byExitReason.map(b=>({reason:b.key,trades:b.closedTrades,realizedPnlUsdt:b.realizedPnlUsdt})),peakConcurrentPositions:r.peakConcurrentPositions,peakExposureRate:r.peakExposureRate});
   }
   return {variant,entryModel:report.entryModel,signalDiagnostics:report.confirmedReversionDiagnostics??null,costChecks:report.confirmedReversionCostChecks??null,report};
 });
 return {...prepared,rows,reports,diagnostics,readiness:screenConfirmedReversionExperiments(rows,prepared.reference.scenarios.map(s=>s.name))};
}
