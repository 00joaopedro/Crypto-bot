import { collectOkxSpotHistory } from './okx-history.js';
import { collectMakerMinutes } from './maker-public-minutes.js';
import { classifyOkxReadError,okxEnvelopeData } from './okx-response-error.js';
import { MAKER_CORE } from './maker-pullback.js';
import type { SwingData,SwingWindow } from './swing-v2-signals.js';
export async function collectSwingHours(window:SwingWindow,transport:typeof fetch=fetch){
 const end=Date.parse(window.endExclusiveUtc),start=Date.parse(window.evaluationStartUtc)-1000*3600000,instruments=[];
 for(const symbol of MAKER_CORE){const hours=await collectOkxSpotHistory(async query=>{
   for(let attempt=0;;attempt++)try{await new Promise(r=>setTimeout(r,300));const response=await transport('https://openapi.okx.com/api/v5/market/history-candles?'+new URLSearchParams(query),{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)}),payload=await response.json();okxEnvelopeData(payload,response.status);return payload;}
   catch(e){const safe=classifyOkxReadError(e);if(!safe.retryableRead||attempt>=2)throw safe;await new Promise(r=>setTimeout(r,1000*2**attempt));}
  },symbol.replace('/','-'),start,end,Date.now(),'1H');instruments.push({symbol,hours});console.log(JSON.stringify({event:'public_swing_hours',symbol,candles:hours.length}));
 }return {window,instruments} satisfies SwingData;
}
export { collectMakerMinutes as collectSwingMinuteWindows };
