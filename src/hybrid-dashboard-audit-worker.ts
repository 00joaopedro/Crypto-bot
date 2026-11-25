import { parentPort,workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { shadowConfiguration } from './hybrid-shadow-session.js';
import { auditShadowSession } from './hybrid-shadow-diagnostics.js';
try{
 const state=JSON.parse(workerData),instruments=state?.data?.instruments;
 if(!Array.isArray(instruments)||!instruments.length||instruments.length>20||instruments.some((d:any)=>!Array.isArray(d.candles15m)||d.candles15m.length>1192||!Array.isArray(d.candles1h)||d.candles1h.length>298))throw new Error('Bounded48h checkpoint required');
 const json=async(p:string)=>JSON.parse(await readFile(new URL('../examples/'+p,import.meta.url),'utf8'));
 const config=shadowConfiguration(await json('hybrid-shadow.profile.json'),await json('hybrid-research.plan.json'),await json('pullback-reference.study.json'));
 const report=auditShadowSession(config,state);
 parentPort!.postMessage({source:'manually_imported_checkpoint_not_live_monitoring',sourceFileSha256:createHash('sha256').update(workerData).digest('hex'),startedAtUtc:state.startedAtUtc,evaluationStart:state.evaluationStart,...report,status:'checkpoint_replayed',sessionStatus:report.status,liveContinuityCertified:false,configurationPromoted:false});
}catch{parentPort!.postMessage({status:'invalid_checkpoint'});}
