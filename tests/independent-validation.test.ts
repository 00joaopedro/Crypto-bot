import { readFileSync } from "node:fs";
import { it,expect } from "vitest";
import { assessIndependentValidationReadiness as assess } from "../src/independent-validation.js";
const data=()=>JSON.parse(readFileSync(new URL("../docs/limited-experiments.json",import.meta.url),"utf8"));
it("blocks all six actual candidates without consuming new holdout data",()=>{
 const result=assess(data());expect(result.status).toBe("blocked_no_eligible_candidate");
 expect(result.candidates).toHaveLength(6);expect(result.candidates.every(c=>!c.passesDevelopmentScreen)).toBe(true);
 expect(result.holdoutExecuted).toBe(false);expect(result.realMoneyApproved).toBe(false);
});
it("does not promote the least negative candidate",()=>{
 const d=data();d.results.forEach((r:any)=>r.netReturnUsdt=-.00001);
 expect(assess(d).status).toBe("blocked_no_eligible_candidate");
});
it("requires all cost scenarios rather than a profitable standard scenario alone",()=>{
 const d=data();d.results.filter((r:any)=>r.scenario==="standard").forEach((r:any)=>{r.netReturnUsdt=10;r.profitFactor=2;});
 expect(assess(d).status).toBe("blocked_no_eligible_candidate");
});
it("requires a frozen protocol even for a synthetic passing screen",()=>{
 const d=data();d.results.forEach((r:any)=>{r.netReturnUsdt=10;r.profitFactor=2;r.closedTrades=50;});
 expect(assess(d)).toMatchObject({status:"frozen_protocol_required",holdoutExecuted:false,realMoneyApproved:false});
});
it("rejects incomplete, duplicate and invalid evidence",()=>{
 const d=data();d.results.pop();expect(()=>assess(d)).toThrow();
 const dup=data();dup.results[0]=dup.results[1];expect(()=>assess(dup)).toThrow(/duplicate/);
 const invalid=data();invalid.results[0].netReturnUsdt=NaN;expect(()=>assess(invalid)).toThrow();
});
it("fingerprints the evidence and distinguishes changed outcomes",()=>{
 const d=data();const a=assess(d).inputHash;expect(assess(d).inputHash).toBe(a);
 d.results[0].netReturnUsdt-=1;expect(assess(d).inputHash).not.toBe(a);
});
