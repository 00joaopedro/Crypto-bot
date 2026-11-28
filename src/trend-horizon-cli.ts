import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import ccxt from 'ccxt';
import { collectOkxSpotHistory } from './okx-history.js';
import { hybridInstrumentRules } from './hybrid-history.js';
import { runTrendHorizon } from './trend-horizon.js';
import { semanticHash } from './cost-experiments.js';
import { classifyOkxReadError } from './okx-response-error.js';
import type { HybridInstrument } from './hybrid-research-replay.js';
const replay=process.argv[2]==='--replay',args=process.argv.slice(replay?3:2),sourcePath=replay?args[0]:undefined,outDir=replay?args[1]:args[0];if(!outDir||args.length!==(replay?2:1))throw new Error('Usage: strategy:trend-horizon -- <NEW-output-directory>; public/offline only');
const json=async(p:string)=>JSON.parse(await readFile(new URL('../'+p,import.meta.url),'utf8')),protocol=await json('examples/trend-horizon.plan.json');
if(createHash('sha256').update(await readFile(new URL('../examples/trend-horizon.plan.json',import.meta.url))).digest('hex')!=='ba10e5f47fb876a420036dcd3255b269bb7972c4abc4e7bd030fb646ff94ae9f')throw new Error('Frozen horizon protocol changed');
await mkdir(outDir,{recursive:false});
let data:{instruments:HybridInstrument[];source:any};
if(replay){data=JSON.parse(await readFile(sourcePath!,'utf8'));if(data.source?.protocolSha256!==semanticHash(protocol))throw new Error('Source protocol mismatch');}else{
const exchange=new ccxt.okx({enableRateLimit:true,timeout:20000}),instruments:HybridInstrument[]=[],end=Date.parse(protocol.window.endExclusiveUtc),start=Date.parse(protocol.window.evaluationStartUtc)-1000*3600000;let requests=0;
try{
 const catalogue=await exchange.publicGetPublicInstruments({instType:'SPOT'});if(catalogue.code!=='0'||!Array.isArray(catalogue.data))throw new Error('Public instruments unavailable');
 for(const symbol of protocol.universe as string[]){const row=catalogue.data.find((r:any)=>r.instId===symbol.replace('/','-'));if(!row)throw new Error('Frozen instrument unavailable: '+symbol);const rules=hybridInstrumentRules(row,symbol,start);
  const candles=await collectOkxSpotHistory(async req=>{for(let attempt=0;;attempt++){requests++;await new Promise(r=>setTimeout(r,250));try{return await exchange.publicGetMarketHistoryCandles(req);}catch(e){const error=classifyOkxReadError(e);if(!error.retryableRead||attempt>=2)throw error;await new Promise(r=>setTimeout(r,1000*2**attempt));}}},symbol.replace('/','-'),start,end,Date.now(),'1H');
  instruments.push({symbol,candles15m:candles,candles1h:[],constraints:rules.constraints});console.log(JSON.stringify({event:'horizon_public_pair_collected',symbol,candles:candles.length}));
 }
}finally{await exchange.close();}
data={instruments,source:{protocolSha256:semanticHash(protocol),start,end,requests,historicalQuoteMinimumKnown:false,currentPublicConstraintsOnly:true}};
}
await writeFile(join(outDir,'normalized-data.json'),JSON.stringify(data));
const report=runTrendHorizon(data,protocol,await json('examples/hybrid-research.plan.json'),await json('examples/pullback-reference.study.json'),await json('examples/hybrid-shadow.profile.json'));
await writeFile(join(outDir,'summary.json'),JSON.stringify({...report,runs:report.runs.map(({entries,closedTradeLedger,...r})=>r)},null,2)+'\n');
await writeFile(join(outDir,'ledgers.json'),JSON.stringify(report.runs.map(({name,scenario,entries,closedTradeLedger})=>({name,scenario,entries,closedTradeLedger})),null,2)+'\n');
console.log(JSON.stringify({status:report.status,runs:report.runs.map(r=>({name:r.name,scenario:r.scenario,trades:r.closedTrades,net:r.netReturnUsdt,pf:r.profitFactor,ev:r.expectancyUsdt,blocks:r.blocks.map(b=>b.netReturnUsdt)})),checks:report.checks}));
