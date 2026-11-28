import { okxEnvelopeData,classifyOkxReadError } from './okx-response-error.js';
import { MAKER_CORE,validateMakerBars,type MakerSignal,type MakerMicro } from './maker-pullback.js';
import type { Candle } from './types.js';
export function parseMakerMinutePage(raw:unknown,hour:number){
 if(!Number.isSafeInteger(hour)||hour<0||hour%3600000)throw new Error('Aligned hour required');
 const rows=okxEnvelopeData(raw,200),all=new Map<number,Candle>();
 for(const r of rows){
  if(!Array.isArray(r)||r.length<9||typeof r[0]!=='string'||!r[0].trim())throw new Error('Invalid minute envelope');const timestamp=Number(r[0]);
  if(!Number.isSafeInteger(timestamp)||timestamp<0||timestamp%60000)throw new Error('Invalid minute timestamp');if(timestamp<hour||timestamp>=hour+3600000)continue;
  if(r[8]!=='1')throw new Error('Unconfirmed minute');
  const values=r.slice(1,6).map(v=>typeof v==='string'&&v.trim()?Number(v):NaN),[open,high,low,close,volume]=values as [number,number,number,number,number];
  const c={timestamp,open,high,low,close,volume},old=all.get(timestamp);if(old&&JSON.stringify(old)!==JSON.stringify(c))throw new Error('Conflicting duplicate minute');all.set(timestamp,c);
 }
 const candles=[...all.values()].sort((a,b)=>a.timestamp-b.timestamp);validateMakerBars(candles,60000);
 if(candles.length!==60||candles[0]!.timestamp!==hour||candles.at(-1)!.timestamp!==hour+3540000)throw new Error('Missing minute coverage');return candles;
}
export async function collectMakerMinutes(signals:Array<Pick<MakerSignal,'symbol'|'entryHour'>>,rules:Record<string,{minimumQuantity:number;quantityStep:number;priceTick:number}>,transport:typeof fetch=fetch,pause:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))){
 const read=async(path:string,query:Record<string,string>)=>{
  if(!['/api/v5/public/instruments','/api/v5/market/history-candles'].includes(path))throw new Error('Public route required');
  for(let attempt=0;;attempt++)try{
   await pause(300);const response=await transport('https://openapi.okx.com'+path+'?'+new URLSearchParams(query),{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});
   const payload=await response.json();okxEnvelopeData(payload,response.status);return payload;
  }catch(e){const safe=classifyOkxReadError(e);if(!safe.retryableRead||attempt>=2)throw safe;await pause(1000*2**attempt);}
 };
 let publicRulesMatched=false;
 try{const rows=okxEnvelopeData(await read('/api/v5/public/instruments',{instType:'SPOT'}),200) as Array<Record<string,unknown>>;
  publicRulesMatched=MAKER_CORE.every(symbol=>{const r=rows.filter(r=>r.instId===symbol.replace('/','-')&&r.instType==='SPOT'&&r.state==='live'),expected=rules[symbol]!;return r.length===1&&Number(r[0]!.minSz)===expected.minimumQuantity&&Number(r[0]!.lotSz)===expected.quantityStep&&Number(r[0]!.tickSz)===expected.priceTick;});
 }catch{/* Unknown catalogue is not fabricated as matching. */}
 const windows:MakerMicro['windows']=[],missing:MakerMicro['missing']=[];
 const seen=new Set<string>();
 for(const s of signals){const key=s.symbol+':'+s.entryHour;if(!MAKER_CORE.includes(s.symbol as typeof MAKER_CORE[number])||seen.has(key))throw new Error('Distinct core windows required');seen.add(key);
  try{const payload=await read('/api/v5/market/history-candles',{instId:s.symbol.replace('/','-'),bar:'1m',after:String(s.entryHour+3600000),limit:'100'});windows.push({symbol:s.symbol,hour:s.entryHour,candles:parseMakerMinutePage(payload,s.entryHour)});}
  catch{missing.push({symbol:s.symbol,hour:s.entryHour,reason:'public_minute_read_or_coverage_failed'});}
 }
 return {windows,missing,publicRulesMatched};
}
