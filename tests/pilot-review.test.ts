import { readFileSync } from "node:fs";
import { expect,it } from "vitest";
import { pilotReview,assessPilotCapital,compareObservedExecution } from "../src/pilot-review.js";
import { effectiveExecutionSnapshot } from "../src/execution-fidelity.js";
import { parseConfig } from "../src/config.js";
const development=JSON.parse(readFileSync(new URL("../docs/limited-experiments.json",import.meta.url),"utf8"));
const capital={equityUsdt:100,freeUsdt:100,exposureUsdt:0,altExposureUsdt:0,symbolExposureUsdt:0,altcoin:true,ceilingUsdt:10,price:10,minimumQuantity:.5,quantityStep:.1,minimumNotionalUsdt:5,stopRate:.01,feeRate:.001,slippageRate:0,liquidityUsdt:100,limits:{riskPerTrade:.01,maxExposure:.25,maxAltExposure:.1,maxSymbolExposure:.15}};
const settings={symbol:"BTC/USDT",orderSizeUsdt:10,maxConcurrentPositions:10,maxTrades:10,intervalMinutes:15};
const snapshot=()=>effectiveExecutionSnapshot(parseConfig({}),settings,undefined,undefined,{commitSha:"1".repeat(40)});
it("does not authorize a pilot with the actual negative development evidence and missing Demo data",()=>{
 const r=pilotReview({development});expect(r.realMoneyApproved).toBe(false);expect(r.blockers).toContain("development_candidates_failed");
 expect(r.blockers).toContain("demo_execution_not_validated");expect(r.capital).toBeNull();expect(r.comparison).toEqual([]);
});
it("skips an unaffordable minimum instead of increasing bankroll risk",()=>{
 expect(assessPilotCapital({...capital,equityUsdt:10,freeUsdt:10})).toMatchObject({status:"entry_must_be_skipped",quantity:0,notionalUsdt:0});
 expect(assessPilotCapital({...capital,minimumNotionalUsdt:20}).status).toBe("entry_must_be_skipped");
});
it("rounds down and retains a conservative fee buffer",()=>{
 const r=assessPilotCapital({...capital,ceilingUsdt:9.99});expect(r.quantity).toBe(.9);expect(r.notionalUsdt).toBe(9);
 expect(r.plannedLossWithCostBufferUsdt).toBeCloseTo(.108);
});
it("rejects invalid prices and inconsistent balances",()=>{
 expect(()=>assessPilotCapital({...capital,price:NaN})).toThrow();
 expect(()=>assessPilotCapital({...capital,freeUsdt:101})).toThrow();
 expect(()=>assessPilotCapital({...capital,altExposureUsdt:1})).toThrow();
});
it("computes adverse price movement with the correct buy/sell direction",()=>{
 const row={symbol:"BTC/USDT",modelPrice:100,modelQuantity:1,observedQuantity:.9,modelFeesUsdt:.1,observedFeesUsdt:.2};
 const r=compareObservedExecution([{...row,side:"buy",observedPrice:101},{...row,side:"sell",observedPrice:99}]);
 expect(r[0]?.adversePriceDeviationBps).toBeCloseTo(100);expect(r[1]?.adversePriceDeviationBps).toBeCloseTo(100);
 expect(r[0]?.quantityDifference).toBeCloseTo(-.1);expect(r[0]?.feeDifferenceUsdt).toBeCloseTo(.1);
});
it("distinguishes code changes from matching configuration hashes",()=>{
 const a=snapshot(), b={...snapshot(),source:{...a.source,commitSha:"2".repeat(40)}};
 expect(pilotReview({development,snapshots:[a,b]}).blockers).toContain("code_or_configuration_changed");
 expect(pilotReview({development,snapshots:[a,a]}).configurationObservation.status).toBe("consistent_samples_only");
});
it("does not equate a covered zero-fill window with an executed Demo validation",()=>{
 const r=pilotReview({development,demoStartUtc:"2026-11-17T00:00:00Z",demoExports:[{generatedAt:"2026-11-19T00:00:00Z",scope:{hours:48,maxRowsPerSection:500},records:[]}]});
 expect(r.demo?.window.status).toBe("export_range_covered");expect(r.blockers).toContain("demo_execution_not_validated");
});
it("still requires independent validation and never enables real trading for a synthetic passing screen",()=>{
 const d=structuredClone(development);d.results.forEach((r:any)=>{r.netReturnUsdt=10;r.profitFactor=2;r.closedTrades=50;});
 const r=pilotReview({development:d,capital,snapshots:[snapshot(),snapshot()]});
 expect(r.blockers).toContain("independent_edge_validation_missing");expect(r.realMoneyApproved).toBe(false);
});
