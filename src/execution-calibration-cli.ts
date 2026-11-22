import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildExecutionCostProfile,calibratedExecutionStudy } from './execution-cost-profile.js';
import { universeStudySchema,compareUniverseSizes,datasetHash,type UniverseDataset } from './universe-comparison.js';
const [planPath,originalPath,dataDirectory,outputDirectory,...diagnostics]=process.argv.slice(2);
if(!planPath||!originalPath||!dataDirectory||!outputDirectory||!diagnostics.length)throw new Error('Usage: execution:calibrate -- <cost-plan.json> <original-study.json> <frozen-data-directory> <new-output-directory> <diagnostic.json> [...]');
if(resolve(dataDirectory)===resolve(outputDirectory))throw new Error('Output must not replace frozen source directory');
const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const original=universeStudySchema.parse(await json(originalPath)),source=await json(join(dataDirectory,'source.json'));
if(!source.complete||!Array.isArray(source.assets)||source.studySha256!==createHash('sha256').update(JSON.stringify(original)).digest('hex'))throw new Error('Frozen source does not match original manifest');
const datasets:UniverseDataset[]=await Promise.all(source.assets.map(async(entry:{symbol:string;filename:string;sha256:string})=>{
  if(entry.filename!==entry.symbol.replace('/','-')+'.json'||!/^[A-Z0-9._-]+-USDT\.json$/.test(entry.filename))throw new Error('Invalid frozen source filename');
  const data=await json(join(dataDirectory,entry.filename));if(data.symbol!==entry.symbol||datasetHash(data)!==entry.sha256)throw new Error('Frozen dataset hash mismatch');return data;
}));
const profile=buildExecutionCostProfile(await Promise.all(diagnostics.map(json)),await json(planPath),datasets.map(d=>d.symbol));
const study=calibratedExecutionStudy(profile,original);
const result=compareUniverseSizes(datasets,study);
const summary={status:'financial_reference_only',studySha256:createHash('sha256').update(JSON.stringify(study)).digest('hex'),sourceStudySha256:source.studySha256,datasetHashes:datasets.map(d=>({symbol:d.symbol,sha256:datasetHash(d)})),configurationHash:profile.snapshot.configurationHash,sourceCommit:profile.snapshot.source.commitSha,
  coverage:profile.coverage,universeCoverage:result.coverage,reference:{budgetUsdt:study.initialBalanceUsdt,lotUsdt:study.tradeSizeUsdt,portfolio:study.portfolio,parameters:study.parameters},
  previousReference:{budgetUsdt:original.initialBalanceUsdt,lotUsdt:original.tradeSizeUsdt,portfolio:original.portfolio,parameters:original.parameters},
  scenarios:result.results.map(r=>({size:r.size,results:r.scenarios.map(s=>({scenario:s.scenario.name,feeRange:[Math.min(...Object.values(s.scenario.symbolCosts!).map(c=>c.feeRate)),Math.max(...Object.values(s.scenario.symbolCosts!).map(c=>c.feeRate))],netReturnUsdt:s.result.netReturnUsdt,profitFactor:s.result.profitFactor,closedTrades:s.result.closedTrades,maxDrawdownUsdt:s.result.maxDrawdownUsdt,blocks:s.result.blocks!.map(b=>({netReturnUsdt:b.netReturnUsdt,closedTrades:b.closedTrades,profitFactor:b.profitFactor}))}))})),
  limitations:[...profile.limitations,'Runtime entry/risk settings differ from the old historical study; P&L differences cannot be attributed solely to fees. This reuses development data, not a new holdout. No configuration is promoted or deployed.']};
await mkdir(outputDirectory,{recursive:true});
for(const [name,value] of Object.entries({'cost-profile.json':profile,'study.json':study,'report.json':result,'summary.json':summary}))await writeFile(join(outputDirectory,name),JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
