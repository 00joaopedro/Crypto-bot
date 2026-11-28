import { emaSeries,averageTrueRange } from './indicators.js';
import { aggregateFourHours } from './trend-horizon.js';
import { MAKER_CORE,validateMakerBars } from './maker-pullback.js';
import { quantizeQuantityDown } from './decimal-quantity.js';
import type { Candle } from './types.js';
import { Precise } from 'ccxt';
export type SwingWindow={evaluationStartUtc:string;endExclusiveUtc:string;days:number;warmupHours:number};
export type SwingData={window:SwingWindow;instruments:Array<{symbol:string;hours:Candle[]}>};
export type SwingSignal={symbol:string;decisionTimestamp:number;entryHour:number;limit:number;stop:number;atr4h:number};
export const floorTick=(p:number,tick:number)=>quantizeQuantityDown(p,1,tick).quantity;
export function ceilTick(p:number,tick:number){const f=floorTick(p,tick);return f>=p?f:Number(new Precise(String(f)).add(new Precise(String(tick))).toString());}
export function swingChecks(history:Candle[],four:Candle[]){
 if(history.length<84)return null;const current=history.at(-1)!,closed=four.filter(c=>c.timestamp+14400000<=current.timestamp+3600000);if(closed.length<250)return null;
 const h=history.map(c=>c.close),a=emaSeries(h,20),b=emaSeries(h,50),fast=emaSeries(closed.map(c=>c.close),20),slow=emaSeries(closed.map(c=>c.close),50);
 const lower=Math.min(a.at(-1)!,b.at(-1)!),upper=Math.max(a.at(-1)!,b.at(-1)!),pullbackLow=Math.min(...history.slice(-3).map(c=>c.low)),structureLow=Math.min(...history.slice(-15,-3).map(c=>c.low)),atr4h=averageTrueRange(closed,14),atr1h=averageTrueRange(history,14);
 const fromAbove=[1,2,3].some(k=>history.at(-k-1)!.close>Math.max(a.at(-k-1)!,b.at(-k-1)!));
 return {limit:(lower+upper)/2,rawStop:pullbackLow-.5*atr1h,atr4h,checks:{regime:current.close>slow.at(-1)!&&fast.at(-1)!>slow.at(-1)!&&[1,2,3].every(k=>fast.at(-k)!>fast.at(-k-1)!&&slow.at(-k)!>slow.at(-k-1)!),amplitude:atr4h/current.close>=.012,retrace:fromAbove&&current.low<=upper&&current.high>=lower&&current.close>=lower,structure:pullbackLow>=structureLow,atr_valid:atr1h>0&&atr4h>0}};
}
export function validateSwingData(data:SwingData,window:SwingWindow){
 const start=Date.parse(window.evaluationStartUtc),end=Date.parse(window.endExclusiveUtc),count=window.days*24+window.warmupHours;
 if(window.warmupHours!==1000||end-start!==window.days*86400000||JSON.stringify(data.window)!==JSON.stringify(window)||JSON.stringify(data.instruments.map(d=>d.symbol))!==JSON.stringify(MAKER_CORE))throw new Error('Frozen swing window/universe mismatch');
 for(const d of data.instruments){validateMakerBars(d.hours,3600000);if(d.hours.length!==count||d.hours[0]!.timestamp!==start-1000*3600000||d.hours.at(-1)!.timestamp!==end-3600000)throw new Error('Incomplete swing history');}
}
export function scanSwingV2(data:SwingData,protocol:any,window:SwingWindow){
 validateSwingData(data,window);const signals:SwingSignal[]=[],funnel=[];
 for(const d of data.instruments){const four=aggregateFourHours(d.hours),row={symbol:d.symbol,decisions:0,rawSignals:0,transitions:0,signals:0,minimumStopRejected:0,passed:{} as Record<string,number>};let prior=false;
  for(let i=999;i<d.hours.length-1;i++){const f=swingChecks(d.hours.slice(0,i+1),four);if(!f)throw new Error('Closed swing warmup required');const raw=Object.values(f.checks).every(Boolean),transition=raw&&!prior;prior=raw;if(i<1000)continue;
   row.decisions++;row.rawSignals+=Number(raw);row.transitions+=Number(transition);for(const[k,v]of Object.entries(f.checks))row.passed[k]=(row.passed[k]??0)+Number(v);
   if(transition&&f.rawStop>0){const tick=protocol.rules[d.symbol].priceTick,limit=floorTick(f.limit,tick),stop=floorTick(f.rawStop,tick);if(stop<=0||stop>=limit)continue;if(1-stop/limit<.009){row.minimumStopRejected++;continue;}
    signals.push({symbol:d.symbol,decisionTimestamp:d.hours[i]!.timestamp,entryHour:d.hours[i+1]!.timestamp,limit,stop,atr4h:f.atr4h});row.signals++;
   }
  }funnel.push(row);
 }
 signals.sort((a,b)=>a.entryHour-b.entryHour||MAKER_CORE.indexOf(a.symbol as any)-MAKER_CORE.indexOf(b.symbol as any));return {signals,funnel};
}
