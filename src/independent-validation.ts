import { z } from "zod";
import { createHash } from "node:crypto";
const row = z.object({
 variant: z.enum(["reference", "delay-two-candles", "managed-atr-trailing"]), size: z.union([z.literal(10),z.literal(30)]),
 scenario: z.enum(["standard","stress","fixed-cost-stress"]), closedTrades: z.number().int().nonnegative(),
 netReturnUsdt: z.number().finite(), profitFactor: z.number().finite().nonnegative().nullable(), maxDrawdownUsdt: z.number().finite().nonnegative(),
}).strict();
const schema = z.object({status:z.literal("exploratory_experiments_only"),protocol:z.string(),results:z.array(row).length(18)}).strict();
/** A development screen, never an independent validation or automatic promotion. */
export function assessIndependentValidationReadiness(input: unknown) {
 const report=schema.parse(input);
 const keys=report.results.map(r=>`${r.variant}:${r.size}:${r.scenario}`);
 if(new Set(keys).size!==18) throw new Error("Incomplete or duplicate experiment matrix");
 const candidates=(["reference","delay-two-candles","managed-atr-trailing"] as const).flatMap(variant=>[10,30].map(size=>{
  const runs=report.results.filter(r=>r.variant===variant&&r.size===size);
  const reasons=runs.flatMap(r=>[
   ...(r.netReturnUsdt<=0?[`${r.scenario}:nonpositive_net_return`]:[]),
   ...(r.closedTrades<30?[`${r.scenario}:small_sample`]:[]),
   ...(r.profitFactor===null||r.profitFactor<=1?[`${r.scenario}:no_positive_closed_trade_edge`]:[]),
  ]);
  return {variant,size,reasons,passesDevelopmentScreen:reasons.length===0};
 }));
 return {schemaVersion:1, inputHash:createHash("sha256").update(JSON.stringify(report)).digest("hex"),
  status:candidates.some(c=>c.passesDevelopmentScreen)?"frozen_protocol_required":"blocked_no_eligible_candidate",
  candidates,holdoutExecuted:false,realMoneyApproved:false,
  limitations:["Development screen uses known, simulated data and project-specific cost scenarios. Thirty closes are a descriptive floor, not statistical proof.",
  "Passing requires a separately recorded code/configuration/dataset freeze, predeclared independent dates including warmup and holdout criteria before any new data is examined.",
  "No winner is selected. Do not re-use a failed holdout to tune parameters and call it independent again.",
  "This screen does not diagnose zero Demo fills, prove engine equivalence, or approve production trading."],
 };
}
