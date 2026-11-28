import { readFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve,join } from 'node:path';
import { shadowConfiguration,type ShadowSnapshot } from './hybrid-shadow-session.js';
import { auditShadowSession } from './hybrid-shadow-diagnostics.js';
import { saveShadowArtifact } from './hybrid-shadow-store.js';
const [directory,output,...extra]=process.argv.slice(2);
if(!directory||!output||extra.length||resolve(directory)===resolve(output))throw new Error('Usage: demo:hybrid-audit -- <session-directory> <distinct-output-directory>; read only, no orders');
const root=new URL('../',import.meta.url),json=async(p:string)=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const config=shadowConfiguration(await json('examples/hybrid-shadow.profile.json'),await json('examples/hybrid-research.plan.json'),await json('examples/pullback-reference.study.json'));
const raw=await readFile(join(directory,'checkpoint.json'));
let collectionEvidence:unknown={status:'unavailable_in_supplied_directory'};
try{const rawEvents=await readFile(join(directory,'collection-events.jsonl'),'utf8');collectionEvidence={sourceSha256:createHash('sha256').update(rawEvents).digest('hex'),events:rawEvents.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
const report={collectionEvidence,...auditShadowSession(config,JSON.parse(raw.toString()) as ShadowSnapshot),sourceFileSha256:createHash('sha256').update(raw).digest('hex')};
await mkdir(output,{recursive:true,mode:0o700});await saveShadowArtifact(output,'diagnostics.json',report);
console.log(JSON.stringify({status:'audit_complete',asOfUtc:report.asOfUtc,balance:report.balance,closedTrades:report.ledger.length,ordersSent:0}));
