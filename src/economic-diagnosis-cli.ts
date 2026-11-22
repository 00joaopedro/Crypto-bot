import { readFile,writeFile,mkdir } from "node:fs/promises";
import { join,resolve } from "node:path";
import { z } from "zod";
import { semanticHash } from "./cost-experiments.js";
import { buildExecutionCostProfile,calibratedExecutionStudy } from "./execution-cost-profile.js";
import { universeStudySchema,datasetHash,compareUniverseSizes,type UniverseDataset } from "./universe-comparison.js";
import { diagnoseEntryEconomics } from "./economic-diagnosis.js";
const [planPath,studyPath,dataDir,baselinePath,outDir,...diagnostics]=process.argv.slice(2);
if(!planPath||!studyPath||!dataDir||!baselinePath||!outDir||!diagnostics.length)throw new Error("Usage: strategy:economics -- <cost-plan.json> <original-study.json> <frozen-data-directory> <financial-summary.json> <new-output-directory> <diagnostic.json> [...]");
if(resolve(outDir)===resolve(dataDir))throw new Error("Output must not replace frozen source");
const json=async(p:string)=>JSON.parse(await readFile(p,"utf8"));
const original=universeStudySchema.parse(await json(studyPath)),source=await json(join(dataDir,"source.json"));
const digest=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().nonnegative();
const baseline=z.object({status:z.literal("financial_reference_only"),sourceStudySha256:digest,studySha256:digest,
 datasetHashes:z.array(z.object({symbol:z.string(),sha256:digest})),coverage:z.object({symbols:count,feeEvidenced:count,feesAssumed:count,measuredBuyQuoteSymbols:count}),
 scenarios:z.array(z.object({size:count,results:z.array(z.object({scenario:z.string(),netReturnUsdt:z.number().finite(),profitFactor:z.number().finite().nullable(),closedTrades:count,maxDrawdownUsdt:z.number().finite().nonnegative()})).length(2)})).length(2),
}).parse(await json(baselinePath));
if(!source.complete||!Array.isArray(source.assets)||source.studySha256!==semanticHash(original)||baseline.sourceStudySha256!==source.studySha256)throw new Error("Frozen source identity mismatch");
const data:UniverseDataset[]=await Promise.all(source.assets.map(async(e:{symbol:string;filename:string;sha256:string})=>{
  if(!/^[A-Z0-9._-]+-USDT\.json$/.test(e.filename)||e.filename!==e.symbol.replace('/','-')+'.json')throw new Error("Invalid source filename");
  const d=await json(join(dataDir,e.filename));if(d.symbol!==e.symbol||datasetHash(d)!==e.sha256)throw new Error("Frozen dataset hash mismatch");return d;
}));
if(new Set(baseline.scenarios.flatMap(u=>u.results.map(r=>`${u.size}:${r.scenario}`))).size!==4)throw new Error("Incomplete financial baseline matrix");
const profiles=buildExecutionCostProfile(await Promise.all(diagnostics.map(json)),await json(planPath),data.map(d=>d.symbol));
const study=calibratedExecutionStudy(profiles,original);
if(semanticHash(study)!==baseline.studySha256)throw new Error("Updated costs/settings change the financial reference: recalibrate explicitly before diagnosis");
const identities=data.map(d=>({symbol:d.symbol,sha256:datasetHash(d)}));
const ordered=(v:typeof identities)=>[...v].sort((a,b)=>a.symbol.localeCompare(b.symbol,'en'));
if(semanticHash(ordered(identities))!==semanticHash(ordered(baseline.datasetHashes)))throw new Error("Baseline datasets differ");
const report=compareUniverseSizes(data,study);
const runs=report.results.flatMap(u=>u.scenarios.map(s=>{
  const prior=baseline.scenarios.find((b:{size:number})=>b.size===u.size)?.results.find((r:{scenario:string})=>r.scenario===s.scenario.name);
  if(!prior||prior.netReturnUsdt!==s.result.netReturnUsdt||prior.profitFactor!==s.result.profitFactor||prior.closedTrades!==s.result.closedTrades||prior.maxDrawdownUsdt!==s.result.maxDrawdownUsdt)throw new Error("Financial baseline not reproduced");
  const evidenced=new Set(profiles.profiles.filter(p=>p.feeObservations>0).map(p=>p.symbol));
  const known=s.result.closedTradeLedger.filter(t=>evidenced.has(t.symbol)).length;
  return {size:u.size,scenario:s.scenario.name,markedPnlUsdt:s.result.netReturnUsdt,feeEvidenceCoverage:{closedTradesWithPairFeeEvidence:known,closedTradesWithAssumedPairFee:s.result.closedTrades-known},...diagnoseEntryEconomics(s.result.closedTradeLedger,data,s.scenario,study.candleLimit)};
}));
const evidence=profiles.profiles.map(p=>({symbol:p.symbol,feeRate:p.feeRate,feeEvidence:p.feeEvidence,feeObservations:p.feeObservations,earliestEvidenceUtc:p.earliestEvidenceUtc,latestEvidenceUtc:p.latestEvidenceUtc,entryFeeCurrency:p.entryFeeCurrency,entryFeeCurrencyEvidence:p.entryFeeCurrencyEvidence,quoteSamples:p.quoteSamples}));
const summary={status:"descriptive_economic_diagnosis_only",studySha256:semanticHash(study),sourceStudySha256:source.studySha256,datasetHashes:identities,
  diagnosticHashes:profiles.evidence.diagnosticHashes,coverage:profiles.coverage,previousCoverage:baseline.coverage,
  baselineReproduced:true,feesUnverifiedSymbols:evidence.filter(p=>p.feeObservations===0).map(p=>p.symbol),feeEvidence:evidence.filter(p=>p.feeObservations>0),
  runs,limitations:profiles.limitations,holdoutExecuted:false,configurationPromoted:false,realMoneyApproved:false};
await mkdir(outDir,{recursive:true});await writeFile(join(outDir,"summary.json"),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({status:summary.status,coverage:summary.coverage,baselineReproduced:true,runs:runs.map(r=>({size:r.size,scenario:r.scenario,...r.accounting})),realMoneyApproved:false},null,2));
