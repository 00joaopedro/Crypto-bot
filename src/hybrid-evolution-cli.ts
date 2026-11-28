import { readFile,mkdir,writeFile,lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { runHybridEvolution } from './hybrid-evolution-study.js';
const [dataPath,outDir,...extra]=process.argv.slice(2);
if(!dataPath||!outDir||extra.length)throw new Error('Usage: strategy:hybrid-evolution -- <frozen-normalized-data.json> <NEW-output-directory>; offline only');
try{await lstat(outDir);throw new Error('Output path already exists; refusing overwrite');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
const root=new URL('../',import.meta.url),json=async(p:string)=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const bytes=await readFile(new URL('examples/hybrid-evolution.plan.json',root)),protocolFileSha256=createHash('sha256').update(bytes).digest('hex');
if(protocolFileSha256!=='21819470719e6bc5f7d33a5493ddb49f408c9d94af011cd1fa2fcc36d5e94f49')throw new Error('Frozen evolution protocol changed');
const summary=await json('docs/hybrid-economic-results.json'),ledgers=await json('docs/hybrid-economic-ledgers.json');
const archived={runs:summary.runs.map((r:any)=>({...r,...ledgers.find((l:any)=>l.name===r.name&&l.scenario===r.scenario)}))};
const report={...runHybridEvolution(JSON.parse(await readFile(dataPath,'utf8')),await json('examples/hybrid-research.plan.json'),await json('examples/pullback-reference.study.json'),await json('examples/hybrid-shadow.profile.json'),archived,JSON.parse(bytes.toString())),protocolFileSha256,protocolFrozenCommit:'b39637e2506811c141101e35c3d93a6f3601c452',limitations:['Previously consulted 30-day development data; three sequential blocks are descriptive, not independent walk-forward validation.','Maker fees/fills, historical depth/spreads/slippage and current minimum notional/account cash are not certified. Fees remain observed taker scenario and doubled stress.','Offline inherited Paper fee/quantity model retains original precision/dust assumptions; current instrument tick rules cannot be projected back into the frozen data.','Timed ROI is net after modeled costs; adverse stops/gaps can still lose. C is isolated, not admitted to the A/B portfolio.','Funnel counts may overlap. Capital time uses whole candles, not exact fills. Open positions are marked, not forced closed.','No configuration, Demo integration, real funds or new 48h session are approved by this report.']};
await mkdir(outDir,{recursive:false,mode:0o700});
await writeFile(join(outDir,'summary.json'),JSON.stringify({...report,runs:report.runs.map(({entries,closedTradeLedger,admissions,...metrics})=>metrics)},null,2)+'\n',{mode:0o600});
await writeFile(join(outDir,'ledgers.json'),JSON.stringify(report.runs.map(({name,scenario,entries,closedTradeLedger,admissions})=>({name,scenario,entries,closedTradeLedger,admissions})),null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({status:report.status,referencesReproduced:report.referencesReproduced,runs:report.runs.map(r=>({name:r.name,scenario:r.scenario,trades:r.closedTrades,net:r.netReturnUsdt,pf:r.profitFactor,ev:r.expectancyUsdt,dd:r.maxDrawdownPercent,holdingMinutes:r.meanClosedHoldingMinutes,blocks:r.blocks.map(b=>b.netReturnUsdt),rejected:r.rejected})),selection:report.selection,funnel:report.funnel},null,2));
