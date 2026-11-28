import { setTimeout as pause } from 'node:timers/promises';
import { MissingConfirmedCandleError } from './okx-history.js';
export type CollectionEvent={event:'collection_retry'|'pair_unavailable'|'pair_recovered';symbol:string;target:string;attempt:number;reason:'missing_confirmed_candle'|'network';recordedAtUtc:string};
/** Bounded per-pair retries; never returns a partial portfolio frame. No raw errors/credentials logged. */
export class ShadowBatchCollector<T>{
 private target='';private ready=new Map<string,T>();private blocked=new Map<string,{until:number;reason:'missing_confirmed_candle'|'network'}>();
 constructor(private readonly options:{clock?:()=>number;sleep?:(ms:number,signal:AbortSignal)=>Promise<void>;isNetworkError?:(e:unknown)=>boolean;emit?:(e:CollectionEvent)=>void|Promise<void>}={}){}
 async collect(target:string,symbols:readonly string[],read:(symbol:string)=>Promise<T>,signal:AbortSignal):Promise<T[]|null>{
  if(!symbols.length||new Set(symbols).size!==symbols.length)throw new Error('Distinct collection symbols required');
  const clock=this.options.clock??Date.now,sleep=this.options.sleep??((ms,s)=>pause(ms,undefined,{signal:s}));
  if(target!==this.target){this.target=target;this.ready.clear();} // discard cached frames when the aligned target changes
  for(const symbol of symbols){
   signal.throwIfAborted();if(this.ready.has(symbol)||(this.blocked.get(symbol)?.until??0)>clock())continue;
   for(let attempt=1;attempt<=3;attempt++){
    signal.throwIfAborted();
    try{const value=await read(symbol);signal.throwIfAborted();this.ready.set(symbol,value);
     const recovered=this.blocked.get(symbol);this.blocked.delete(symbol);
     if(recovered)await this.options.emit?.({event:'pair_recovered',symbol,target,attempt,reason:recovered.reason,recordedAtUtc:new Date(clock()).toISOString()});break;
    }catch(e){
     signal.throwIfAborted();const missing=e instanceof MissingConfirmedCandleError,network=this.options.isNetworkError?.(e)===true;
     if(!missing&&!network)throw e; // malformed/conflicting data is an integrity failure, never retry into acceptance
     const reason=missing?'missing_confirmed_candle':'network',recent=missing&&clock()>=e.timestamp+e.duration&&clock()-(e.timestamp+e.duration)<=2*e.duration;
     if(attempt<3&&(network||recent)){
      await this.options.emit?.({event:'collection_retry',symbol,target,attempt,reason,recordedAtUtc:new Date(clock()).toISOString()});await sleep(attempt*2000,signal);
     }else{this.blocked.set(symbol,{until:clock()+60000,reason});await this.options.emit?.({event:'pair_unavailable',symbol,target,attempt,reason,recordedAtUtc:new Date(clock()).toISOString()});break;}
    }
   }
  }
  return symbols.every(s=>this.ready.has(s))?symbols.map(s=>this.ready.get(s)!):null;
 }
}
