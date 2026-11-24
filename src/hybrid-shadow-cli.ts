import { OkxCandleStream } from './okx-candle-stream.js';
import { SpotInstrumentCache } from './spot-entry-preflight.js';
import { classifyOkxReadError,okxEnvelopeData,OkxReadError } from './okx-response-error.js';
import { readFile,writeFile,readdir,appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import ccxt from 'ccxt';
import { ShadowBatchCollector } from './hybrid-shadow-collection.js';
import { auditShadowSession } from './hybrid-shadow-diagnostics.js';
import { collectUniverseHistory } from './universe-history.js';
import { collectOkxSpotHistory } from './okx-history.js';
import { hybridInstrumentRules } from './hybrid-history.js';
import { shadowConfiguration,startShadowSession,advanceShadowSession,type ShadowSnapshot } from './hybrid-shadow-session.js';
import { lockShadowSession,readShadowCheckpoint,saveShadowCheckpoint,saveShadowArtifact } from './hybrid-shadow-store.js';
import type { HybridInstrument } from './hybrid-research-replay.js';
const [directory,...flags]=process.argv.slice(2);
if(!directory||directory.startsWith('--')||new Set(flags).size!==flags.length||flags.some(f=>!['--once','--websocket'].includes(f)))throw new Error('Usage: demo:hybrid-shadow -- <session-directory> [--once] [--websocket]; Paper only, no exchange orders');
const once=flags.includes('--once'),withStream=flags.includes('--websocket');
const root=new URL('../',import.meta.url),json=async(p:string)=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const config=shadowConfiguration(await json('examples/hybrid-shadow.profile.json'),await json('examples/hybrid-research.plan.json'),await json('examples/pullback-reference.study.json'));
const codeFiles=(await readdir(new URL('./',import.meta.url))).filter(p=>p.endsWith('.js')).sort();
const digest=createHash('sha256');digest.update(process.versions.node);digest.update(await readFile(new URL('package-lock.json',root)));
for(const p of codeFiles){digest.update(p);digest.update(await readFile(new URL(p,import.meta.url)));}const codeFingerprint=digest.digest('hex');
const release=await lockShadowSession(directory),exchange=new ccxt.okx({enableRateLimit:true,timeout:20000});
const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
let stream:OkxCandleStream|undefined;
const instrumentCache=new SpotInstrumentCache();
const fetchPage=async(request:{instId:string;bar:'15m'|'1H';after:string;limit:string})=>{
 await wait(250,undefined,{signal:controller.signal});
 const cached=stream?.pageBefore(request.instId,request.bar,Number(request.after),Number(request.limit));
 if(cached)return {code:'0',data:cached};
 try{const result=await exchange.publicGetMarketHistoryCandles(request);okxEnvelopeData(result);stream?.acceptRestPage(request.instId,request.bar,result);return result;}catch(e){const error=classifyOkxReadError(e);console.log(JSON.stringify({event:'market_rest_read_failed',...error.safeDetails()}));if(e instanceof ccxt.NetworkError)throw e;throw error;}
};
const readPublicInstruments=async()=>{
 try{return okxEnvelopeData(await exchange.publicGetPublicInstruments({instType:'SPOT'}));}
 catch(e){const error=classifyOkxReadError(e);console.log(JSON.stringify({event:'public_instruments_read_failed',...error.safeDetails()}));throw error;}
};
const collector=new ShadowBatchCollector<HybridInstrument>({isNetworkError:e=>e instanceof ccxt.NetworkError||(e instanceof OkxReadError&&e.retryableRead),emit:async event=>{await appendFile(join(directory,'collection-events.jsonl'),JSON.stringify(event)+'\n',{mode:0o600});console.log(JSON.stringify(event));}});
try{
 let state=await readShadowCheckpoint(directory);let staleWarmups=0;
 if(state)state=advanceShadowSession(config,state,state.data,codeFingerprint);
 const mode=withStream?'ws_rest_repair':'rest',profilePath=join(directory,'transport-profile.json');
 try{const previousTransport=JSON.parse(await readFile(profilePath,'utf8'));if(previousTransport.mode!==mode)throw new Error('Frozen transport mode changed; use a new session directory');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;if(state&&withStream)throw new Error('Existing REST checkpoint cannot silently switch transport');await writeFile(profilePath,JSON.stringify({mode,channels:withStream?['candle15m','candle1H']:[],ordersSent:0})+'\n',{flag:'wx',mode:0o600});}
 let specs:HybridInstrument[]=state?.data.instruments??[];
 if(!state){
  const catalogue=await readPublicInstruments();
  instrumentCache.update(catalogue);
  const validRows=catalogue.filter(v=>v&&typeof v==='object'&&!Array.isArray(v)) as Record<string,unknown>[];
  const rows=new Map<string,Record<string,unknown>>(validRows.map((v:Record<string,unknown>)=>[String(v.instId),v]));
  const start=Math.floor(Date.now()/900000)*900000-1000*900000;
  const skipped:Array<{symbol:string;reason:string}>=[];
  for(const symbol of config.strategy.watchlist){try{if(!instrumentCache.get(symbol))throw new Error('unconfirmed_current_public_spot_rules');const row=rows.get(symbol.replace('/','-'));if(!row)throw new Error('missing_from_public_spot_list');const terms=hybridInstrumentRules(row,symbol,start);specs.push({symbol,constraints:terms.constraints,candles15m:[],candles1h:[]});}catch(e){skipped.push({symbol,reason:String(e)});}}
  await writeFile(join(directory,'public-coverage.json'),JSON.stringify({skipped,minimumNotionalVerified:false,demoAvailabilityVerified:false,accountQueried:false,ordersSent:0},null,2)+'\n',{mode:0o600});
 }
 let nextRulesRefresh=state?0:Date.now()+3600000;
 await saveShadowArtifact(directory,'current-instruments.json',{observedAtUtc:new Date().toISOString(),rules:specs.map(s=>instrumentCache.get(s.symbol)),ordersSent:0,source:'public_instruments_not_account_permission'});
 if(withStream){stream=new OkxCandleStream(specs.map(s=>s.symbol),{emit:event=>console.log(JSON.stringify(event))});stream.start();}
 while(!controller.signal.aborted){
  if(Date.now()>=nextRulesRefresh){
   try{const page=await readPublicInstruments();instrumentCache.update(page);nextRulesRefresh=Date.now()+3600000;
    await saveShadowArtifact(directory,'current-instruments.json',{observedAtUtc:new Date().toISOString(),rules:specs.map(s=>instrumentCache.get(s.symbol)),ordersSent:0,source:'public_instruments_not_account_permission'});
   }catch(e){nextRulesRefresh=Date.now()+60000;console.log(JSON.stringify({event:'instrument_rules_refresh_failed',...classifyOkxReadError(e).safeDetails(),newOrderPermission:false}));}
  }
  const now=Date.now(),end=Math.min(Math.floor(now/900000)*900000,state?state.evaluationStart+48*3600000:Infinity),start=state?state.evaluationStart-1000*900000:end-1000*900000;
  const mustCollect=!state||Date.parse(state.data.asOfUtc)<end;
  if(mustCollect){
   const instruments=await collector.collect(new Date(end).toISOString(),specs.map(s=>s.symbol),async symbol=>{
    const spec=specs.find(s=>s.symbol===symbol)!;
    const old=state?.data.instruments.find(d=>d.symbol===spec.symbol),from=old?Date.parse(state!.data.asOfUtc):start;
    const quarter=await collectUniverseHistory(fetchPage,spec.symbol.replace('/','-'),from,end,Date.now());
    const hourStart=old?.candles1h.length?old.candles1h.at(-1)!.timestamp+3600000:Math.floor(start/3600000)*3600000,hourEnd=Math.floor(end/3600000)*3600000;
    const hours=hourStart<hourEnd?await collectOkxSpotHistory(fetchPage,spec.symbol.replace('/','-'),hourStart,hourEnd,Date.now(),'1H'):[];
    return {...spec,candles15m:[...(old?.candles15m??[]),...quarter.candles],candles1h:[...(old?.candles1h??[]),...hours],quoteVolumesUsdt:[...(old?.quoteVolumesUsdt??[]),...quarter.quoteVolumesUsdt]};
   },controller.signal);
   if(!instruments){
    const health={status:'collection_blocked',targetUtc:new Date(end).toISOString(),committedAsOfUtc:state?.data.asOfUtc??null,recordedAtUtc:new Date().toISOString(),ordersSent:0};
    await saveShadowArtifact(directory,'collection-health.json',health);console.log(JSON.stringify(health));
    if(once)throw new Error('Shadow collection incomplete; checkpoint preserved');
    await wait(60000,undefined,{signal:controller.signal});continue;
   }
   if(!state&&Date.now()-end>900000){
    if(++staleWarmups>2)throw new Error('Fresh warmup could not be established');
    console.log(JSON.stringify({event:'warmup_stale_retry',ordersSent:0}));continue;
   }
   const data={asOfUtc:new Date(end).toISOString(),instruments};
   state=state?advanceShadowSession(config,state,data,codeFingerprint):startShadowSession(config,data,codeFingerprint,Date.now());
  }else if(state){state=advanceShadowSession(config,state,state.data,codeFingerprint);}
  if(!state)throw new Error('Shadow session unavailable');
  const previous=await readShadowCheckpoint(directory);
  await saveShadowCheckpoint(directory,state);
  if(previous?.data.asOfUtc!==state.data.asOfUtc||state.status==='completed'){
   const report=auditShadowSession(config,state);await saveShadowArtifact(directory,'diagnostics.json',report);
   console.log(JSON.stringify({event:'shadow_diagnostics',asOfUtc:state.data.asOfUtc,balance:report.balance,funnel:report.funnel.map(r=>({symbol:r.symbol,strategy_mode:r.strategy_mode,candles:r.candles,signals:r.signals})),admissions:report.admissions,detailsFile:'diagnostics.json',scope:'cumulative_reconstructed_not_incremental',ordersSent:0}));
   for(const trade of report.ledger.slice(previous?.result?.closedTrades??0))console.log(JSON.stringify({event:'shadow_trade_closed',...trade,ordersSent:0}));
  }
  await saveShadowArtifact(directory,'collection-health.json',{status:'collection_ready',committedAsOfUtc:state.data.asOfUtc,recordedAtUtc:new Date().toISOString(),ordersSent:0});
  console.log(JSON.stringify({status:state.status,environment:'paper_public_only',asOfUtc:state.data.asOfUtc,pairs:state.data.instruments.length,closedTrades:state.result?.closedTrades??0,netReturnUsdt:state.result?.netReturnUsdt??0,openPosition:state.result?.openPosition??null,allocationMode:config.profile.allocationMode,ordersSent:0,paidAiCalls:false,realMoneyApproved:false}));
  if(stream)console.log(JSON.stringify({event:'market_stream_status',...stream.summary()}));
  if(once||state.status==='completed')break;
  await wait(60000,undefined,{signal:controller.signal});
 }
}catch(e){if(!controller.signal.aborted)throw e;}finally{stream?.stop();await exchange.close();await release();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
