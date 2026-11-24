import { OkxReadError } from './okx-response-error.js';
import { setTimeout as pause } from 'node:timers/promises';
import { HYBRID_WATCHLIST } from './hybrid-research-signals.js';
import { createOkxReadOnlyClient,inspectOkxReadOnly } from './okx-read-only-inspection.js';
const names=['OKX_READ_API_KEY','OKX_READ_SECRET_KEY','OKX_READ_PASSPHRASE','OKX_READ_ENVIRONMENT'] as const;
/** Manual, cached account read. No fallback to operational Trade credentials or environment. */
export function createAccountTermsRead(environment:NodeJS.ProcessEnv,transport:typeof fetch=fetch,clock=()=>new Date()){
 const settings=Object.fromEntries(names.map(n=>[n,environment[n]]));
 const missing=names.filter(n=>!settings[n]?.trim());
 const selected=settings.OKX_READ_ENVIRONMENT;
 let inFlight:Promise<unknown>|undefined,cached:unknown,expires=0;
 return async():Promise<unknown>=>{
  if(missing.length||!(selected==='demo'||selected==='real'))return {status:'not_configured',reason:'dedicated_read_credentials_and_explicit_environment_required',requiredVariables:names,ordersSent:0};
  if(cached!==undefined&&clock().getTime()<expires)return cached;
  if(inFlight)return inFlight;
  inFlight=(async()=>{
   const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),20000);
   try{
    const bounded:typeof fetch=(input,init)=>transport(input,{...init,signal:AbortSignal.any([deadline.signal,...(init?.signal?[init.signal]:[])])});
    const client=createOkxReadOnlyClient({apiKey:settings.OKX_READ_API_KEY!,secretKey:settings.OKX_READ_SECRET_KEY!,passphrase:settings.OKX_READ_PASSPHRASE!},selected,bounded,clock);
    return await inspectOkxReadOnly(client,selected,[...HYBRID_WATCHLIST],clock,{maximumSymbols:20,beforeFee:()=>pause(500,undefined,{signal:deadline.signal})});
   }catch(e){return {status:'unavailable',reason:e instanceof Error&&e.message==='A dedicated Read-only API key is required'?'dedicated_read_key_required':'read_query_failed',environment:selected,ordersSent:0,...(e instanceof OkxReadError?{readError:e.safeDetails()}:{})};}
   finally{clearTimeout(timer);}
  })().then(result=>{cached=result;expires=clock().getTime()+60000;return result;}).finally(()=>{inFlight=undefined;});
  return inFlight;
 };
}
