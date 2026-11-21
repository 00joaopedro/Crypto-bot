import { z } from "zod";
import { assessIndependentValidationReadiness } from "./independent-validation.js";
import { summarizeDemoValidation } from "./demo-validation-report.js";
import { validateExecutionSnapshot } from "./execution-fidelity.js";
import { positionSize, positionSizingSchema } from "./position-sizing.js";
import { quantizeQuantityDown } from "./decimal-quantity.js";
const positive=z.number().finite().positive();
const rate=z.number().finite().min(0).lt(1);
const capitalSchema=z.object({equityUsdt:positive,freeUsdt:z.number().finite().nonnegative(),exposureUsdt:z.number().finite().nonnegative(),altExposureUsdt:z.number().finite().nonnegative(),symbolExposureUsdt:z.number().finite().nonnegative(),altcoin:z.boolean(),ceilingUsdt:positive,price:positive,minimumQuantity:positive,quantityStep:positive,minimumNotionalUsdt:z.number().finite().nonnegative(),stopRate:positive.lt(1),feeRate:rate,slippageRate:rate,liquidityUsdt:positive,limits:positionSizingSchema}).strict();
export function assessPilotCapital(input: unknown) {
 const c=capitalSchema.parse(input);
 if(c.freeUsdt>c.equityUsdt||c.altExposureUsdt>c.exposureUsdt||c.symbolExposureUsdt>c.exposureUsdt)throw new Error("Inconsistent capital/exposure evidence");
 const amount=positionSize({limits:c.limits,equity:c.equityUsdt,free:c.freeUsdt,exposure:c.exposureUsdt,altExposure:c.altExposureUsdt,symbolExposure:c.symbolExposureUsdt,altcoin:c.altcoin,ceiling:c.ceilingUsdt,stopRate:c.stopRate,fee:c.feeRate,slippage:c.slippageRate,liquidity:c.liquidityUsdt});
 const rounded=quantizeQuantityDown(amount,c.price,c.quantityStep);
 const feasible=rounded.quantity>0&&rounded.quantity>=c.minimumQuantity&&rounded.notional>=c.minimumNotionalUsdt;
 return {status:feasible?"illustrative_size_feasible":"entry_must_be_skipped",quantity:feasible?rounded.quantity:0,notionalUsdt:feasible?rounded.notional:0,
  plannedLossWithCostBufferUsdt:feasible?rounded.notional*(c.stopRate+2*(c.feeRate+c.slippageRate)):0,
  limitation:"Supplied instrument/rate/price/liquidity inputs are not exchange-verified here. This is a sizing estimate, not a guaranteed maximum loss. Never raise size to meet a minimum."};
}
const matchSchema=z.object({symbol:z.string().min(3),side:z.enum(["buy","sell"]),modelPrice:positive,observedPrice:positive,modelQuantity:positive,observedQuantity:positive,modelFeesUsdt:z.number().finite().nonnegative(),observedFeesUsdt:z.number().finite().nonnegative()}).strict();
export function compareObservedExecution(input: unknown) {
 const matches=z.array(matchSchema).parse(input);
 return matches.map(m=>({symbol:m.symbol,side:m.side,adversePriceDeviationBps:(m.side==="buy"?m.observedPrice/m.modelPrice-1:1-m.observedPrice/m.modelPrice)*10000,
 quantityDifference:m.observedQuantity-m.modelQuantity,feeDifferenceUsdt:m.observedFeesUsdt-m.modelFeesUsdt}));
}
export function pilotReview(input: {development:unknown;demoStartUtc?:string;demoExports?:unknown[];snapshots?:unknown[];matchedExecutions?:unknown;capital?:unknown}) {
 const development=assessIndependentValidationReadiness(input.development);
 const blockers:string[]=[];
 // A development pass is not an independent edge validation.
 blockers.push(development.status==="blocked_no_eligible_candidate"?"development_candidates_failed":"independent_edge_validation_missing");
 const demo=input.demoStartUtc&&input.demoExports?.length?summarizeDemoValidation(input.demoStartUtc,input.demoExports):null;
 if(!demo?.executionAssessment.operationalValidationPassed)blockers.push("demo_execution_not_validated");
 const snapshots=(input.snapshots??[]).map(validateExecutionSnapshot);
 const identities=new Set(snapshots.map(s=>`${s.source.commitSha}:${s.configurationHash}`));
 if(snapshots.length<2||snapshots.some(s=>!s.source.commitSha))blockers.push("configuration_freeze_evidence_missing");
 else if(identities.size!==1)blockers.push("code_or_configuration_changed");
 const comparison=compareObservedExecution(input.matchedExecutions??[]);
 if(!comparison.length)blockers.push("matched_execution_evidence_missing");
 const capital=input.capital===undefined||input.capital===null?null:assessPilotCapital(input.capital);
 if(!capital)blockers.push("intended_capital_and_instrument_rules_missing");
 else if(capital.status!=="illustrative_size_feasible")blockers.push("capital_below_permitted_risk_or_minimum");
 return {status:"pilot_not_authorized",realMoneyApproved:false,blockers,development,demo,
  configurationObservation:{samples:snapshots.length,identities:identities.size,status:identities.size===1&&snapshots.length>=2&&snapshots.every(s=>s.source.commitSha)?"consistent_samples_only":"unconfirmed_or_changed"},comparison,capital,
  limitations:["Snapshot samples do not prove a continuous freeze or worker uptime; inspect the complete configuration/deployment journal over the window.",
  "Matched rows must be independently reconciled to the same symbol/order/fill and timestamp. This helper cannot establish their provenance or convert non-USDT fees.",
  "No independent edge evidence or human pilot decision is synthesized. Real-money trading is never enabled, even if descriptive checks look favorable.",
  "Simulation, Demo account balance and a small real bankroll are different capital bases. A BRL bankroll requires a current, explicit conversion to spendable USDT; no exchange rate is assumed."]};
}
