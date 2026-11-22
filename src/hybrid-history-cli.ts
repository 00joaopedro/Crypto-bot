import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import ccxt from 'ccxt';
import { hybridCollectionWindow,hybridInstrumentRules,collectHybridPair,validateHybridCollection,verifyHybridSnapshot } from './hybrid-history.js';
import { semanticHash } from './cost-experiments.js';
import type { HybridInstrument } from './hybrid-research-replay.js';
const verify=process.argv[2]==='--verify';
const [planPath,studyPath,outDir,...extra]=process.argv.slice(verify?3:2);
if(!planPath||!studyPath||!outDir||extra.length)throw new Error('Usage: strategy:hybrid-collect -- <plan.json> <collection.json> <NEW-output-directory>');
const plan=JSON.parse(await readFile(planPath,'utf8')),study=JSON.parse(await readFile(studyPath,'utf8')),window=hybridCollectionWindow(study,plan);
if(verify){
 const data=JSON.parse(await readFile(join(outDir,'normalized-data.json'),'utf8')),source=JSON.parse(await readFile(join(outDir,'source.json'),'utf8'));
 verifyHybridSnapshot(data,source,study,plan);console.log('Frozen hybrid snapshot verified: '+semanticHash(data));
}else{
await mkdir(outDir,{recursive:false});
const exchange=new ccxt.okx({enableRateLimit:true,timeout:20000}),demo=new ccxt.okx({enableRateLimit:true,timeout:20000,headers:{'x-simulated-trading':'1'}});
const capturedAtUtc=new Date().toISOString(),instruments:HybridInstrument[]=[],skipped:Array<{symbol:string;reason:string}>=[],terms:Array<Record<string,unknown>>=[];
let requests=0,demoList:Set<string>|null=null;
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 const response=await exchange.publicGetPublicInstruments({instType:'SPOT'});requests++;
 if(response.code!=='0'||!Array.isArray(response.data))throw new Error('Public instrument list unavailable');
 const markets=new Map<string,Record<string,unknown>>(response.data.map((row:Record<string,unknown>)=>[String(row.instId),row]));
 try{const r=await demo.publicGetPublicInstruments({instType:'SPOT'});requests++;if(r.code==='0'&&Array.isArray(r.data))demoList=new Set(r.data.filter((x:Record<string,unknown>)=>x.state==='live'&&x.instType==='SPOT').map((x:Record<string,unknown>)=>String(x.instId)));}catch{console.log('WARN Demo public instrument list unavailable; no account availability is inferred');}
 for(const symbol of window.plan.watchlist){
  const row=markets.get(symbol.replace('/','-'));
  if(!row){skipped.push({symbol,reason:'missing_from_public_spot_list'});continue;}
  if(demoList&&!demoList.has(symbol.replace('/','-'))){skipped.push({symbol,reason:'missing_from_demo_public_instrument_list'});continue;}
  let rules:ReturnType<typeof hybridInstrumentRules>;
  try{rules=hybridInstrumentRules(row,symbol,window.start);}catch(e){skipped.push({symbol,reason:String(e)});continue;}
  // A present, valid instrument with missing/corrupt history fails the study rather than dropping it after observing outcomes.
  const d=await collectHybridPair(async request=>{
   for(let attempt=0;;attempt++){
    requests++;await wait(250);
    try{return await exchange.publicGetMarketHistoryCandles(request);}catch(e){if(!(e instanceof ccxt.NetworkError)||attempt>=2)throw e;await wait(1000*2**attempt);}
   }
  },symbol,rules.constraints,window.start,window.end,Date.now());
  instruments.push(d);terms.push({symbol,...rules.terms});
  await writeFile(join(outDir,symbol.replace('/','-')+'.json'),JSON.stringify(d)+'\n',{flag:'wx'});
  console.log(`COLLECTED ${symbol}: ${d.candles15m.length} x15m, ${d.candles1h.length} x1H`);
 }
 validateHybridCollection(instruments,study,plan);
 const data={asOfUtc:window.study.endExclusiveUtc,instruments};
 await writeFile(join(outDir,'normalized-data.json'),JSON.stringify(data)+'\n',{flag:'wx'});
 const source={protocol:'hybrid-public-source-v1',complete:true,capturedAtUtc,collection:window.study,collectionSha256:semanticHash(window.study),planSha256:semanticHash(window.plan),datasetSha256:semanticHash(data),evaluationStartUtc:new Date(window.evaluationStart).toISOString(),warmupStartUtc:new Date(window.start).toISOString(),requests,
  assets:instruments.map(d=>({symbol:d.symbol,sha256:semanticHash(d),candles15m:d.candles15m.length,candles1h:d.candles1h.length})),skipped,terms,demoPublicListObserved:demoList!==null,accountAvailabilityVerified:false,feesQueried:false,
  limitations:['Current public instrument rules are applied retrospectively; historical rule changes and delisted assets remain unknown.','Matching pagination overlaps are deduplicated; conflicting duplicates and any missing closed interval fail collection.','minimumNotionalUsdt=0 is a replay placeholder for an unknown quote minimum, not a verified exchange minimum. Account permission, balance and fees are not queried.']};
 await writeFile(join(outDir,'source.json'),JSON.stringify(source,null,2)+'\n',{flag:'wx'});
 console.log('HYBRID_SOURCE='+JSON.stringify(source));
}finally{await exchange.close();await demo.close();}

}
