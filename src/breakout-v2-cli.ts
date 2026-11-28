import { readFile,writeFile,mkdir,rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join,resolve } from 'node:path';
import { collectSwingHours,collectSwingMinuteWindows } from './swing-v2-data.js';
import {type SwingData,type SwingWindow} from './swing-v2-signals.js';
import {scanBreakoutV2} from './breakout-v2-signals.js';
import {replayBreakoutV2,screenBreakoutV2} from './breakout-v2-replay.js';
import { semanticHash } from './cost-experiments.js';
import type { MakerMicro } from './maker-pullback.js';
const [mode,dataDir,outDir,...extra]=process.argv.slice(2);
if(!['--collect','--replay'].includes(mode??'')||!dataDir||!outDir||extra.length||resolve(dataDir)===resolve(outDir))throw new Error('Usage: strategy:breakout-v2 <--collect|--replay> <data-directory> <NEW-output-directory>; public/offline, no orders');
const root=new URL('../',import.meta.url),bytes=await readFile(new URL('examples/breakout-v2.plan.json',root)),hash=createHash('sha256').update(bytes).digest('hex'),protocol=JSON.parse(bytes.toString());
if(hash!=='ad5ddfc5c473dce35189a280784aaf19173005f62940573ce017d4f3f34921ec')throw new Error('Frozen final-round protocol changed');
const frozen=JSON.parse(await readFile(new URL('examples/breakout-v2.freeze.json',root),'utf8'));
if(frozen.protocolFileSha256!==hash||!/^[a-f0-9]{40}$/.test(frozen.protocolFrozenCommit)||frozen.replayBeforeFreeze!==false)throw new Error('Published breakout freeze required');
const priorH1=JSON.parse(await readFile(new URL('docs/swing-v2-results.json',root),'utf8'));if(semanticHash(priorH1)!=='ff22ecd6812ccebf1585782814089c068e457b46b2b5fc9d2362560fc3c7ed4e'||priorH1.economicGo!==false)throw new Error('Prior H1 final-round result identity changed');
await mkdir(outDir,{recursive:false});if(mode==='--collect')await mkdir(dataDir,{recursive:true});
const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const atomic=async(path:string,value:unknown)=>{const tmp=path+'.tmp-'+process.pid;await writeFile(tmp,JSON.stringify(value)+'\n',{flag:'wx'});await rename(tmp,path);};
const phase=async(name:string,window:SwingWindow)=>{
 const hourPath=join(dataDir,name+'-hours.json'),microPath=join(dataDir,name+'-minutes.json');let data:SwingData;
 try{data=await json(hourPath);}catch(e){if(mode!=='--collect'||(e as NodeJS.ErrnoException).code!=='ENOENT')throw e;if(name==='development')throw new Error('Restore pinned H1v2 development hours; no new hour source permitted');data=await collectSwingHours(window);await writeFile(hourPath,JSON.stringify(data)+'\n',{flag:'wx'});}
 if(name==='development'&&semanticHash(data)!==protocol.developmentSource.hoursSha256)throw new Error('Frozen180day hour source changed');
 const {signals,funnel}=scanBreakoutV2(data,protocol,window);let micro:MakerMicro;
 try{micro=await json(microPath);}catch(e){if(mode!=='--collect'||(e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const requests=signals.flatMap(s=>[0,1,2,3].map(k=>({symbol:s.symbol,entryHour:s.entryHour+k*3600000})));
  const unique=new Map(requests.map(r=>[r.symbol+':'+r.entryHour,r]));if(unique.size!==requests.length)throw new Error('Overlapping frozen4h signal windows');
  if(requests.length>protocol.dataBudget.maxMinuteWindowsPerPhase)throw new Error('Frozen minute budget exceeded');micro=await collectSwingMinuteWindows(requests,protocol.rules);await atomic(microPath,micro);
 }
 let runs:any[]=[];let dataBlocked=false;
 for(let iteration=0;iteration<=protocol.dataBudget.maxMinuteWindowsPerPhase;iteration++){
  runs=protocol.scenarios.map((s:any)=>replayBreakoutV2(data,signals,micro,protocol,s,window));
  const needed=new Map<string,{symbol:string;entryHour:number}>();for(const r of runs)for(const n of r.needed??[])needed.set(n.symbol+':'+n.entryHour,n);
  if(!needed.size)break;
  if(mode==='--replay'){dataBlocked=true;break;}
  const attempted=new Set([...micro.windows.map(w=>w.symbol+':'+w.hour),...micro.missing.map(w=>w.symbol+':'+w.hour)]),requests=[...needed].filter(([k])=>!attempted.has(k)).map(([,v])=>v).sort((a,b)=>a.entryHour-b.entryHour||a.symbol.localeCompare(b.symbol));
  if(!requests.length||attempted.size+requests.length>protocol.dataBudget.maxMinuteWindowsPerPhase){dataBlocked=true;break;}
  const added=await collectSwingMinuteWindows(requests,protocol.rules);micro={windows:[...micro.windows,...added.windows],missing:[...micro.missing,...added.missing],publicRulesMatched:micro.publicRulesMatched&&added.publicRulesMatched};await atomic(microPath,micro);
  console.log(JSON.stringify({event:'public_breakout_event_minutes',phase:name,completeWindows:micro.windows.length,missingWindows:micro.missing.length}));
 }
 const screened=screenBreakoutV2(runs);
 return {name,window,signalCount:signals.length,funnel,hoursSha256:semanticHash(data),minutesSha256:semanticHash(micro),minuteCoverage:{completeWindows:micro.windows.length,missingWindows:micro.missing.length,catalogueMatchedFrozenRules:micro.publicRulesMatched},status:dataBlocked?'blocked_missing_event_minutes':runs.some(r=>r.status==='blocked_unprotectable_inventory')?'blocked_unprotectable_inventory':screened.passed?'conditional_modeled_screen_passed':'no_go',economicPassed:!dataBlocked&&screened.passed,checks:screened.checks,runs};
};
const development=await phase('development',protocol.window);
// A rejected development candidate never opens or collects the independent source.
const independent=development.economicPassed?await phase('independent',protocol.independentWindow):null;
const economicGo=development.economicPassed&&independent?.economicPassed===true;
const phases=[development,...(independent?[independent]:[])];
const dataComplete=phases.every(p=>p.runs.every(r=>r.status==='modeled_replay_complete')),researchCycleClosed=dataComplete&&!economicGo&&!priorH1.economicGo;
const report={protocol:protocol.protocol,protocolFileSha256:hash,protocolFrozenCommit:frozen.protocolFrozenCommit,status:economicGo?'offline_go_requires_native_review':!dataComplete?'blocked_final_round_evidence':'no_go_final_round_closed',economicGo,finalRound:{thisHypothesis:2,secondHypothesisV2Executed:true,priorH1EconomicGo:priorH1.economicGo,priorH1ResultSha256:semanticHash(priorH1),researchCycleClosed,archiveResearch:researchCycleClosed,repositoryArchived:false,operationalServicesChanged:false,noV3Authorized:true},
 phases:phases.map(p=>({...p,runs:p.runs.map(r=>{const{orders,events,closedTradeLedger,...metrics}=r;return metrics;})})),
 independentDataCollected:independent!==null,independentReservation:protocol.independentWindow,limitations:[
 '180-day development includes previously consulted90days; it is not independent. Separate earlier historical holdout is consulted only on a predeclared development pass, and is not chronological forward validation or certification of all outside human consultation history.',
 'Maker0.1% entry/target and taker0.4% stops are user-reported account quotes applied as model rates, not authenticated historical fills. Actual queue, maker role, latency and native protection are unverified.',
 'Maker target executes at its resting limit. A separate modeled execution reserve is charged for uncertainty and explicitly excluded from actual exchange fee claims. Stop friction is modeled in the taker price.',
 'Entry and event-hour1m use trade-through/participation assumptions; touch is no fill. Stop-first, no target on new-fill minute, and minute-close protection/closed4h trailing effective next minute are conventions, not a rigorous portfolio lower bound.',
 'Current/public quantity/tick rules do not certify historical minima, minimum notional, private access or real available funds. Partial residual below protectable minimum blocks the model.',
 'Projected+0.2R protected stop is not a guaranteed profit under gaps, failures or slippage. Real balance0;17USDT is simulated. No real order, paid AI, merge, deployment, Railway change or current configuration promotion.',
 ],demoIntegrationApproved:false,configurationPromoted:false,realMoneyApproved:false,ordersSent:0,paidAiCalls:false};
const ledgers={protocol:report.protocol,protocolFrozenCommit:frozen.protocolFrozenCommit,phases:phases.map(p=>({name:p.name,hoursSha256:p.hoursSha256,minutesSha256:p.minutesSha256,runs:p.runs.map(r=>({scenario:r.scenario,orders:r.orders??[],events:r.events??[],closedTradeLedger:r.closedTradeLedger??[]}))}))};
await writeFile(join(outDir,'summary.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});await writeFile(join(outDir,'ledgers.json'),JSON.stringify(ledgers,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,economicGo,phases:report.phases.map(p=>({name:p.name,signals:p.signalCount,coverage:p.minuteCoverage,status:p.status,runs:p.runs,checks:p.checks})),independentDataCollected:report.independentDataCollected,ordersSent:0}));
