import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { Precise } from "ccxt";
import { semanticHash } from "./cost-experiments.js";
import { pullbackPlanSchema, screenPullbackExperiments } from "./pullback-experiments.js";
import { volatilityExitPlanSchema, screenVolatilityExitExperiments } from "./volatility-exit-experiments.js";
import { confirmedReversionPlanSchema, screenConfirmedReversionExperiments } from "./confirmed-reversion-experiments.js";
import { universeStudySchema, datasetHash, validateUniverseDatasets, type UniverseDataset, type UniverseStudy } from "./universe-comparison.js";
import { comparisonSlippage, scenarioCosts } from "./strategy-comparison.js";
import { quantizeQuantityDown } from "./decimal-quantity.js";

const digest=z.string().regex(/^[a-f0-9]{64}$/), count=z.number().int().nonnegative(), finite=z.number().finite();
const identity=z.object({symbol:z.string().regex(/^[A-Z0-9._-]+\/USDT$/),sha256:digest}).strict();
const rowSchema=z.object({variant:z.string(),size:z.union([z.literal(10),z.literal(30)]),scenario:z.string(),netReturnUsdt:finite,realizedPnlUsdt:finite,
 profitFactor:finite.nonnegative().nullable(),closedTrades:count,expectancyUsdt:finite.nullable(),maxDrawdownUsdt:finite.nonnegative(),recoveryFactor:finite.nullable(),
 top3TradesProfitSharePercent:finite.nonnegative().nullable(),realizedPnlWithoutTop3Usdt:finite,
 blocks:z.array(z.object({netReturnUsdt:finite,closedTrades:count,profitFactor:finite.nonnegative().nullable()}).strict()).length(2),
}).strict();
const reportSchema=z.object({status:z.string(),protocol:z.unknown(),protocolSha256:digest,referenceStudySha256:digest,sourceStudySha256:digest,
 datasetHashes:z.array(identity).min(2),referenceConfigurationHash:digest,referenceSourceCommit:z.string().regex(/^[a-f0-9]{40}$/),referenceStudy:z.unknown(),results:z.array(rowSchema),
});
export const portfolioReadinessPlanSchema=z.object({protocol:z.literal("portfolio-readiness-v1"),referenceStudySha256:digest,sourceStudySha256:digest,
 capitalScenariosUsdt:z.tuple([z.literal(10),z.literal(20),z.literal(50),z.literal(100),z.literal(5000)]),allocationPolicy:z.literal("conditional_no_fixed_split"),
 intendedCapital:z.object({currency:z.literal("BRL"),amount:z.literal(100),spendableUsdt:z.null()}).strict(),
}).strict();
const identitiesKey=(rows:z.infer<typeof identity>[])=>{
 if(new Set(rows.map(r=>r.symbol)).size!==rows.length)throw new Error("Duplicate dataset identity");
 return semanticHash([...rows].sort((a,b)=>a.symbol.localeCompare(b.symbol,"en")));
};
function verifyMetrics(rows:z.infer<typeof rowSchema>[]){
 const close=(a:number,b:number)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
 for(const r of rows){
  if(!close(r.blocks.reduce((a,b)=>a+b.netReturnUsdt,0),r.netReturnUsdt)||r.blocks.reduce((a,b)=>a+b.closedTrades,0)!==r.closedTrades)throw new Error("Incoherent development blocks");
  if(r.closedTrades===0?(r.expectancyUsdt!==null||r.profitFactor!==null||!close(r.realizedPnlUsdt,0)):(r.expectancyUsdt===null||!close(r.expectancyUsdt,r.realizedPnlUsdt/r.closedTrades)))throw new Error("Incoherent closed-trade expectancy");
  if(r.realizedPnlWithoutTop3Usdt>r.realizedPnlUsdt+1e-8)throw new Error("Incoherent top-three concentration");
 }
}
/** Recompute from metrics; editable readiness/approval flags in the inputs have no authority. */
export function assessPortfolioReadiness(rawReports:unknown[],rawFinancial:unknown,rawPlan:unknown){
 const plan=portfolioReadinessPlanSchema.parse(rawPlan);
 const financial=z.object({status:z.literal("financial_reference_only"),studySha256:digest,sourceStudySha256:digest,datasetHashes:z.array(identity),configurationHash:digest,sourceCommit:z.string(),
  scenarios:z.array(z.object({size:count,results:z.array(z.object({scenario:z.string(),netReturnUsdt:finite,profitFactor:finite.nullable(),closedTrades:count,maxDrawdownUsdt:finite}))})),
 }).parse(rawFinancial);
 if(rawReports.length!==3||financial.studySha256!==plan.referenceStudySha256||financial.sourceStudySha256!==plan.sourceStudySha256)throw new Error("Portfolio source/reference mismatch");
 const reports=rawReports.map(r=>reportSchema.parse(r));
 const protocols=[pullbackPlanSchema.parse(reports[0]!.protocol),volatilityExitPlanSchema.parse(reports[1]!.protocol),confirmedReversionPlanSchema.parse(reports[2]!.protocol)];
 const expectedStatus=["pullback_development_experiments_only","volatility_exit_development_experiments_only","confirmed_reversion_development_experiments_only"];
 const reference=universeStudySchema.parse(reports[0]!.referenceStudy),scenarioNames=reference.scenarios.map(s=>s.name);
 const financialKeys=financial.scenarios.flatMap(u=>u.results.map(s=>`${u.size}:${s.scenario}`));
 if(financialKeys.length!==4||new Set(financialKeys).size!==4||[10,30].flatMap(size=>scenarioNames.map(s=>`${size}:${s}`)).some(k=>!financialKeys.includes(k)))throw new Error("Incomplete financial baseline");
 const rows=new Map<string,z.infer<typeof rowSchema>>();
 const baselineRows=new Map<string,z.infer<typeof rowSchema>>();
 reports.forEach((report,i)=>{
  const study=universeStudySchema.parse(report.referenceStudy),protocol=protocols[i]!;
  if(report.status!==expectedStatus[i]||semanticHash(protocol)!==report.protocolSha256||report.referenceStudySha256!==plan.referenceStudySha256||report.sourceStudySha256!==plan.sourceStudySha256||protocol.referenceStudySha256!==plan.referenceStudySha256||protocol.sourceStudySha256!==plan.sourceStudySha256||semanticHash(study)!==plan.referenceStudySha256||report.referenceConfigurationHash!==financial.configurationHash||report.referenceSourceCommit!==financial.sourceCommit||identitiesKey(report.datasetHashes)!==identitiesKey(financial.datasetHashes))throw new Error("Development report identity mismatch");
  verifyMetrics(report.results);
  for(const r of report.results){
   const key=`${r.variant}:${r.size}:${r.scenario}`;
   if(r.variant==="reference"){
    const b=financial.scenarios.find(u=>u.size===r.size)?.results.find(s=>s.scenario===r.scenario);
    if(!b||b.netReturnUsdt!==r.netReturnUsdt||b.profitFactor!==r.profitFactor||b.closedTrades!==r.closedTrades||b.maxDrawdownUsdt!==r.maxDrawdownUsdt)throw new Error("Financial baseline differs");
    const prior=baselineRows.get(key);if(prior&&!isDeepStrictEqual(prior,r))throw new Error("Repeated baseline metrics differ");baselineRows.set(key,r);
   }else if(rows.has(key))throw new Error("Unexpected duplicated candidate");
   rows.set(key,r);
  }
 });
 const screens=[screenPullbackExperiments(reports[0]!.results,scenarioNames),screenVolatilityExitExperiments(reports[1]!.results,scenarioNames),screenConfirmedReversionExperiments(reports[2]!.results,scenarioNames)];
 const candidates=new Map<string,{variant:string;strategy:"trend"|"confirmed_mean_reversion";passesDevelopmentScreen:boolean;reasons:string[]}>();
 for(const screen of screens)for(const c of screen.candidates)candidates.set(c.variant,{...c,strategy:c.variant==="confirmed-mean-reversion"?"confirmed_mean_reversion":"trend"});
 const eligible=[...candidates.values()].filter(c=>c.passesDevelopmentScreen),strategies=[...new Set(eligible.map(c=>c.strategy))];
 return {status:eligible.length===0?"blocked_no_eligible_candidate":strategies.length<2?"single_strategy_selection_protocol_required":"combination_protocol_required",
  protocol:plan,protocolSha256:semanticHash(plan),inputReportHashes:rawReports.map(semanticHash),referenceStudySha256:plan.referenceStudySha256,sourceStudySha256:plan.sourceStudySha256,
  datasetHashes:financial.datasetHashes,referenceConfigurationHash:financial.configurationHash,referenceSourceCommit:financial.sourceCommit,
  inputRows:reports.reduce((n,r)=>n+r.results.length,0),uniqueRows:rows.size,repeatedBaselineRowsRemoved:reports.reduce((n,r)=>n+r.results.length,0)-rows.size,
  candidates:[...candidates.values()],eligibleVariants:eligible.map(c=>c.variant),eligibleStrategies:strategies,results:[...rows.values()],
  combination:{simulationExecuted:false,combinedExecutionImplemented:false,allocation:null,allocatedUsdt:0,reason:eligible.length===0?"no_development_candidate_passed":strategies.length<2?"do_not_require_multiple_strategies":"predeclared_shared_wallet_protocol_required",
   requirements:["Single shared cash/exposure/position limits","Strategy identity on every order/position","One position per symbol across strategies and reservation before submission","Predeclared conflict/ranking rules; raw scores are not assumed comparable","Compare isolated and combined AFTER common costs; no forced 50/50 split"]},
  holdoutExecuted:false,configurationPromoted:false,realMoneyApproved:false,reference,
  limitations:["These are dependent alternatives on the same inspected development data. Repeated reference rows are removed, never pooled as independent evidence.","Metrics and hashes establish internal identity/coherence, not independently authenticated market data or correctness of every simulated fill.","Improved losses, positive before-fee P&L or zero operations are not eligible net edge. No best-loser promotion or automatic selection even for synthetic passes.","Combination may alter trades, costs and risk. No combined profit, diversification benefit or correlation estimate is invented from isolated P&L sums.","Candidate eligibility is a development prerequisite; stability, independent frozen validation and operational capital/execution review remain required."]};
}

/** Empty-wallet admission at the last frozen close, with the actual fixed lot (not a smaller invented lot). */
export function assessReferenceBudgets(datasets:UniverseDataset[],reference:UniverseStudy,capitals:readonly number[]){
 validateUniverseDatasets(datasets,reference);
 if(!capitals.length||new Set(capitals).size!==capitals.length||capitals.some(v=>!Number.isFinite(v)||v<=0))throw new Error("Invalid budget scenarios");
 const rows=reference.scenarios.flatMap(scenario=>capitals.map(equity=>{
  const rejected:Record<string,string[]>={minimum:[],cash:[],exposure:[]},feasible:string[]=[];
  for(const d of datasets){
   const costs=scenarioCosts(scenario,d.symbol),fill=d.candles.at(-1)!.close*(1+comparisonSlippage(costs));
   const order=quantizeQuantityDown(reference.tradeSizeUsdt,fill,d.constraints.quantityStep);
   const cashCost=order.notional*(costs.entryFeeCurrency==="quote"?1+costs.feeRate:1);
   const netQuantity=Number(new Precise(String(order.quantity)).mul(new Precise("1").sub(new Precise(String(costs.entryFeeCurrency==="base"?costs.feeRate:0)))).toString());
   const sellable=netQuantity>0?quantizeQuantityDown(netQuantity,1,d.constraints.quantityStep):{quantity:0,notional:0};
   const minimum=order.quantity>0&&order.quantity>=d.constraints.minimumQuantity&&order.notional>=d.constraints.minimumNotionalUsdt&&sellable.quantity>0&&sellable.quantity>=d.constraints.minimumQuantity&&sellable.quantity*fill>=d.constraints.minimumNotionalUsdt;
   const cash=cashCost<=equity;
   const exposure=order.notional<=equity*reference.portfolio.maxExposureRate&&(d.symbol==="BTC/USDT"||order.notional<=equity*reference.portfolio.maxAltExposureRate);
   if(!minimum)rejected.minimum!.push(d.symbol);if(!cash)rejected.cash!.push(d.symbol);if(!exposure)rejected.exposure!.push(d.symbol);
   if(minimum&&cash&&exposure)feasible.push(d.symbol);
  }
  return {scenario:scenario.name,equityUsdt:equity,fixedLotCeilingUsdt:reference.tradeSizeUsdt,exposureCapUsdt:equity*reference.portfolio.maxExposureRate,nominalLotSlots:Math.min(reference.portfolio.maxConcurrentPositions,Math.floor(equity*reference.portfolio.maxExposureRate/reference.tradeSizeUsdt)),feasibleFixedLotSymbols:feasible.length,feasibleSymbols:feasible,rejected};
 }));
 return {status:"frozen_price_capacity_only",snapshotUtc:new Date(datasets[0]!.candles.at(-1)!.timestamp).toISOString(),datasetHashes:datasets.map(d=>({symbol:d.symbol,sha256:datasetHash(d)})),referenceCapitalUsdt:reference.initialBalanceUsdt,rows,
  zeroNotionalMinimumSymbols:datasets.filter(d=>d.constraints.minimumNotionalUsdt===0).map(d=>d.symbol),
  allocatedUsdt:0,allocationExecuted:false,intendedCapitalAssessment:"blocked_spendable_usdt_and_current_terms_unconfirmed",
  limitations:["Frozen historical price/rules and assumed costs, empty wallet, fixed lot and shared exposure limits. A feasible row is not a signal, allocation or live funding recommendation.","The collector hardcodes minimumNotionalUsdt=0; it captures minSz/lotSz but does not verify a current minimum order value or all execution rules. Reported feasibility is conditional, not exchange-confirmed.","Budget scenarios are illustrative USDT amounts, not converted BRL or the user's balance. Intended R$100 lacks confirmed spendable USDT and current rules.",
  "Capacity checks cash, exposure and recorded minimums only; it does not assert a valid signal, liquid membership, execution liquidity, regional eligibility or complete live risk admission.","Reference risk sizing is disabled: this assessment does not silently enable dormant risk/symbol caps or reduce the configured fixed lot to fit capital. Slippage gaps can exceed initial-stop estimates.","No funding, order, automatic 50/50 split, budget increase, portfolio simulation or promotion is performed. Shared-wallet strategy budgets remain conditional on eligible candidates."]};
}
