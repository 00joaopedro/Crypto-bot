import { readFile,writeFile,mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { hybridPlanSchema } from "./hybrid-research-signals.js";
import { scanHybridResearch,replayHybridDecisions,type HybridVariant } from "./hybrid-research-replay.js";
import { universeStudySchema } from "./universe-comparison.js";
import { comparisonSchema } from "./strategy-comparison.js";
import { semanticHash } from "./cost-experiments.js";
const args=process.argv.slice(2);
const includeCostHypotheses=args.at(-1)==='--include-cost-hypotheses';
if(includeCostHypotheses)args.pop();
const [planPath,baselinePath,dataPath,outDir,...extra]=args;
if(!planPath||!baselinePath||Boolean(dataPath)!==Boolean(outDir)||extra.length)throw new Error('Usage: strategy:hybrid-research -- <plan.json> <baseline.study.json> [<normalized-data.json> <NEW-output-directory>] [--include-cost-hypotheses]');
const json=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const plan=hybridPlanSchema.parse(await json(planPath)),reference=universeStudySchema.parse(await json(baselinePath));
if(semanticHash(reference)!==plan.baselineStudySha256||reference.parameters.exitPolicy?.mode!=='fixed'||reference.parameters.exitPolicy.breakeven)throw new Error('Frozen baseline identity or exit policy mismatch');
const descriptor={status:'offline_hybrid_protocol_only',costScope:includeCostHypotheses?'archived_full_matrix':'account_reference_and_stress_only',paidAiCalls:false,plan,protocolSha256:semanticHash(plan),baselineStudySha256:semanticHash(reference),baselineParameters:reference.parameters,
 variants:['baseline','trend_pullback','mean_reversion','hybrid'],profitabilityValidated:false,liveScannerChanged:false,configurationPromoted:false,realMoneyApproved:false};
if(!dataPath||!outDir){console.log(JSON.stringify(descriptor,null,2));}else{
 const candle=z.object({timestamp:z.number().int(),open:z.number(),high:z.number(),low:z.number(),close:z.number(),volume:z.number()}).strict();
 const data=z.object({asOfUtc:z.iso.datetime(),instruments:z.array(z.object({symbol:z.string(),candles15m:z.array(candle),candles1h:z.array(candle),constraints:comparisonSchema.shape.constraints,quoteVolumesUsdt:z.array(z.number()).optional()}).strict()).min(1).max(20)}).strict().parse(await json(dataPath));
 const cutoff=Date.parse(data.asOfUtc);
 if(cutoff>Date.now()||data.instruments.some(d=>d.candles15m.some(c=>c.timestamp+900000>cutoff)||d.candles1h.some(c=>c.timestamp+3600000>cutoff)))throw new Error('Only closed candles at the declared cutoff are allowed');
 const hypo=(name:string,m:number)=>({name,feeRate:.001*m,slippageRate:.0005*m,spreadRate:.0015*m,assumedDepthUsdt:1000/m,maxParticipationRate:.001/m,symbolCosts:Object.fromEntries(plan.watchlist.map(s=>[s,{feeRate:.001*m,slippageRate:.0005*m,spreadRate:.0015*m,entryFeeCurrency:'base' as const}]))});
 const scenarios=[...(includeCostHypotheses?[hypo('gemini-hypothesis',1),hypo('gemini-stress-hypothesis',2)]:[]),...reference.scenarios.map(s=>({...s,symbolCosts:Object.fromEntries(plan.watchlist.map(symbol=>[symbol,s.symbolCosts?.[symbol]??{feeRate:s.feeRate,slippageRate:s.slippageRate,spreadRate:s.spreadRate,entryFeeCurrency:'base' as const}]))}))];
 const runs=[];
 for(const variant of ['baseline','trend_pullback','mean_reversion','hybrid'] as HybridVariant[]){
  const decisions=scanHybridResearch(data.instruments,plan,variant,reference.parameters);
  for(const scenario of scenarios){const result=replayHybridDecisions(data.instruments,decisions,plan,scenario,reference.parameters,plan.warmup15m);runs.push({variant,scenario,result});}
 }
 const summary={...descriptor,status:'offline_hybrid_supplied_data_replay',datasetSha256:semanticHash(data),asOfUtc:data.asOfUtc,includedSymbols:data.instruments.map(d=>d.symbol),missingFromInput:plan.watchlist.filter(s=>!data.instruments.some(d=>d.symbol===s)),demoAvailabilityVerified:false,
  scenarios:scenarios.map(s=>({name:s.name,evidence:s.name.startsWith('gemini')?'declared_hypothesis_not_verified':'archived_partial_account_evidence_and_declared_assumptions',missingFromArchivedCostMap:plan.watchlist.filter(symbol=>!reference.scenarios[0]!.symbolCosts?.[symbol])})),
  runs:runs.map(({variant,scenario,result})=>{const {entries,closedTradeLedger,...metrics}=result;return {variant,scenario:scenario.name,...metrics};}),
  limitations:['This command consumes supplied local data only; no exchange, private account or operational scanner is accessed. Missing pairs are listed; coverage is not certified as the 20 most liquid markets.',
   'Only archived account-reference costs and stress run by default. The optional archived fee/slippage hypotheses never call an AI API. Account evidence is partial; none proves real-account fees.',
   'New 17 USDT fixed-lot/one-position allocation is explicitly separate from the legacy 10% exposure constraint. Initial loss estimates are not guaranteed gap protection. No risk cap is changed in production.',
   'Baseline signal logic and fixed ATR exits are reused with common study capital/list/costs. Old dynamic-universe and 5000-USDT results are not directly comparable.',
   'Three blocks are chronological accounting of the same cash/positions, not independent evidence or automatic walk-forward certification. Incomplete blocks remain flagged; no holdout, selection, promotion or Demo deployment is performed.',
   'OHLC timing, fills, trigger rounding, native protection, dust, scheduler, daily/global risk admission and account parity remain approximations. Cooldown is shared from the frozen baseline parameters.']};
 await mkdir(outDir,{recursive:false});
 await writeFile(join(outDir,'summary.json'),JSON.stringify(summary,null,2)+'\n');
 for(let i=0;i<runs.length;i++)await writeFile(join(outDir,`run-${i}.json`),JSON.stringify(runs[i],null,2)+'\n');
 console.log(JSON.stringify(summary,null,2));
}
