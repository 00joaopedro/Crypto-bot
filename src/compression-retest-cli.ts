import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { replayMakerPullback,validateMakerMicro } from './maker-pullback.js';
import { compressionSource } from './compression-retest.js';
import { collectMakerMinutes } from './maker-public-minutes.js';
import { semanticHash } from './cost-experiments.js';
const [mode,sourcePath,minutePath,outDir,...extra]=process.argv.slice(2);
if(!['--collect','--replay'].includes(mode??'')||!sourcePath||!minutePath||!outDir||extra.length)throw new Error('Usage: strategy:compression-retest -- <--collect|--replay> <frozen1h-data> <minute-source.json> <NEW-output-directory>; public/offline only');
const root=new URL('../',import.meta.url),bytes=await readFile(new URL('examples/compression-retest.plan.json',root)),hash=createHash('sha256').update(bytes).digest('hex'),protocol=JSON.parse(bytes.toString());
if(hash!=='1a6ef05932f597ea5834f280b0be4301e253ef58454d18a49fb65fdeea168d32')throw new Error('Frozen compression protocol changed');
const frozen=JSON.parse(await readFile(new URL('examples/compression-retest.freeze.json',root),'utf8'));
if(frozen.protocolFileSha256!==hash||!/^[a-f0-9]{40}$/.test(frozen.protocolFrozenCommit)||frozen.historicalReplayPerformedBeforeFreeze!==false)throw new Error('Published compression protocol freeze required');
const data=JSON.parse(await readFile(sourcePath,'utf8')),{signals,funnel}=compressionSource(data,protocol);
let micro;
if(mode==='--collect'){
 try{micro=JSON.parse(await readFile(minutePath,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;micro=await collectMakerMinutes(signals,protocol.rules);await writeFile(minutePath,JSON.stringify(micro)+'\n',{flag:'wx'});}
}else micro=JSON.parse(await readFile(minutePath,'utf8'));
const missing=validateMakerMicro(data,signals,micro),runs=protocol.scenarios.map((scenario:any)=>replayMakerPullback(data,signals,micro,protocol,scenario,'compression'));
const checks=runs.map((r:any)=>({scenario:r.scenario??null,complete:r.status==='modeled_replay_complete',sample:typeof r.closedTrades==='number'&&r.closedTrades>=30,pf:r.profitFactor!==null&&r.profitFactor>1.25,ev:r.expectancyUsdt>0,net:r.netReturnUsdt>0,blocks:Array.isArray(r.blocks)&&r.blocks.length===3&&r.blocks.every((b:any)=>b.complete&&b.netReturnUsdt>0),drawdown:r.maxDrawdownPercent<10,withoutTop3:r.realizedPnlWithoutTop3Usdt>0}));
const economicScreenPassed=checks.length===2&&checks.every((c:any)=>c.complete&&c.sample&&c.pf&&c.ev&&c.net&&c.blocks&&c.drawdown&&c.withoutTop3);
const report={protocol:protocol.protocol,protocolFileSha256:hash,protocolFrozenCommit:frozen.protocolFrozenCommit,sourceDatasetSha256:semanticHash(data),minuteSourceSha256:semanticHash(micro),window:protocol.window,bankUsdt:17,lotCeilingUsdt:10,signalCount:signals.length,funnel,minuteCoverage:{requestedWindows:signals.length,completeWindows:micro.windows.length,missingWindows:missing.length,catalogueMatchedFrozenRules:micro.publicRulesMatched},checks,economicScreenPassed,
 status:missing.length?'blocked_missing_minute_data':runs.some((r:any)=>r.status==='blocked_unprotectable_partial')?'blocked_unprotectable_partial':economicScreenPassed?'conditional_modeled_screen_passed_not_validated':'blocked_no_eligible_candidate',
 limitations:['Maker/taker rates are user-reported real-account quotes, not authenticated historical fills. Real cash is0, planned bank17. No private account queries.',
 'Minute trade-through, posting spread proxy and volume participation are fill assumptions; candles do not show side, queue priority, latency or actual maker execution. Not a native Demo test.',
 'Five-minute order life, partials/cancel/reservations/fees and unprotectable inventory are simulated. Stop-first and no target in a new-fill minute are intrabar conventions, not a rigorous lower bound on portfolio profit.',
 'Current matched public quantity/tick rules do not certify historical rules, minimum notional or account instrument access. Dust is recorded and conservatively written off, never treated as a new position sale.',
 'Trailing arms only from closed-hour net PnL>=2*initial net risk and uses highest owned close minus2ATR, effective next hour. No retroactive activation from highs.',
 'Development data already consulted; no selection/retuning after results, no independent period collected. Favorable simulation would still require separate data and native execution validation.'],
 independentDataCollected:false,demoIntegrationApproved:false,configurationPromoted:false,realMoneyApproved:false,ordersSent:0,paidAiCalls:false,
 runs:runs.map((r:any)=>{const{orders,events,closedTradeLedger,...metrics}=r;return metrics;})};
await mkdir(outDir,{recursive:false});
await writeFile(join(outDir,'summary.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
await writeFile(join(outDir,'ledgers.json'),JSON.stringify({protocol:protocol.protocol,protocolFrozenCommit:frozen.protocolFrozenCommit,minuteSourceSha256:semanticHash(micro),runs:runs.map((r:any,i:number)=>({scenario:protocol.scenarios[i].name,orders:r.orders??[],events:r.events??[],closedTradeLedger:r.closedTradeLedger??[]}))},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,signalCount:signals.length,coverage:report.minuteCoverage,runs:report.runs,checks,ordersSent:0}));
