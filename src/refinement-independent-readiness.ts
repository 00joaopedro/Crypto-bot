import { assessPortfolioReadiness } from "./portfolio-readiness.js";
import { universeStudySchema } from "./universe-comparison.js";
import { semanticHash } from "./cost-experiments.js";
import { REGIME_CANDLE_MS } from "./btc-regime.js";

/** Only recomputes prerequisite readiness. No independent-window data parameter or collector exists here. */
export function assessRefinementIndependentReadiness(reports:unknown[],financial:unknown,plan:unknown,rawSource:unknown){
 const development=assessPortfolioReadiness(reports,financial,plan),source=universeStudySchema.parse(rawSource);
 if(semanticHash(source)!==development.sourceStudySha256)throw new Error("Independent readiness source hash mismatch");
 const end=Date.parse(source.endExclusiveUtc),start=end-(source.days*96+source.warmupCandles)*REGIME_CANDLE_MS;
 const intended=development.protocol.intendedCapital;
 const blockers=[...(development.eligibleVariants.length===0?["no_eligible_development_candidate"]:[]),
  ...(intended.currency==="USDT"&&intended.amount!==development.reference.initialBalanceUsdt?["declared_capital_not_replayed_in_development"]:[]),
  "local_parameter_stability_not_established","intended_account_costs_and_spendable_balance_unconfirmed","current_instrument_terms_unconfirmed","code_candidate_cost_risk_freeze_missing","complete_inspection_registry_not_verified"];
 return {status:development.eligibleVariants.length===0?"blocked_no_eligible_candidate":"blocked_independent_preconditions_missing",
  schemaVersion:1,developmentEvidenceHashes:development.inputReportHashes,referenceStudySha256:development.referenceStudySha256,sourceStudySha256:development.sourceStudySha256,
  declaredIntendedCapital:intended,referenceCapitalUsdt:development.reference.initialBalanceUsdt,eligibleVariants:development.eligibleVariants,candidates:development.candidates,blockers,
  consultedDevelopmentWindow:{startUtc:new Date(start).toISOString(),endExclusiveUtc:new Date(end).toISOString(),includesWarmup:true},minimumWarmupCandles:Math.max(source.warmupCandles,development.reference.candleLimit-1),
  futureProtocolRequirements:["Freeze eligible candidate, code commit, per-pair costs, universe, capital, risk and execution policy BEFORE new data inspection","Record all inspected periods; exclude evaluation AND warmup overlaps","Predeclare separate blocks, minimum sample, net expectancy/PF, concentration, drawdown and adverse-cost criteria","A failed independent result rejects the candidate; never retune the same window and call it unseen"],
  independentDataCollected:false,newWindowSelected:false,freezePrepared:false,holdoutExecuted:false,configurationPromoted:false,realMoneyApproved:false,
  limitations:["This step completes conditional readiness, not a financial independent test. No new data is collected, selected, read or replayed.","Declared 17 USDT is intended capital, not proof of current available balance, allocation, live configuration or exchange feasibility.","Even synthetic development passes do not establish stability, authenticated account terms or a complete inspection registry. Future freeze preparation remains blocked until those prerequisites are implemented and evidenced.","Existing cost-only independent protocol remains separate; new refinement variants are not silently certified through its old candidate definitions.","A future 48h Demo window verifies operation of a frozen version; it does not establish profitability or approve real funds."]};
}
export function requireRefinementFreezeReadiness(readiness:ReturnType<typeof assessRefinementIndependentReadiness>):never{
 throw new Error(readiness.eligibleVariants.length===0?"No eligible development candidate: independent freeze blocked":"Independent prerequisites missing: freeze blocked");
}
