import { averageTrueRange } from './indicators.js';
import { aggregateFourHours } from './trend-horizon.js';
import { MAKER_CORE } from './maker-pullback.js';
import { validateSwingData,floorTick,type SwingData,type SwingSignal,type SwingWindow } from './swing-v2-signals.js';
import type { Candle } from './types.js';
export function breakoutV2Checks(closed:Candle[]){
 if(closed.length<45)return null;
 const previous=closed.slice(0,-1),current=closed.at(-1)!,box=previous.slice(-8),top=Math.max(...box.map(c=>c.high)),bottom=Math.min(...box.map(c=>c.low)),atr=averageTrueRange(previous,14),atrNow=averageTrueRange(closed,14),meanAtr=Array.from({length:30},(_,k)=>averageTrueRange(previous.slice(0,previous.length-k),14)).reduce((a,b)=>a+b,0)/30,volume=previous.slice(-20).reduce((a,c)=>a+c.volume,0)/20;
 return {top,bottom,atr4h:atrNow,checks:{compression:top-bottom<2.2*atr,relative_atr:atr<meanAtr,breakout:current.close>top,volume:volume>0&&current.volume>=1.3*volume,body:current.close>current.open&&current.close-current.open>=.5*atr,atr_valid:atr>0&&atrNow>0}};
}
export function scanBreakoutV2(data:SwingData,protocol:any,window:SwingWindow){
 validateSwingData(data,window);const signals:SwingSignal[]=[],funnel=[];const start=Date.parse(window.evaluationStartUtc);
 for(const d of data.instruments){const four=aggregateFourHours(d.hours),row={symbol:d.symbol,decisions:0,rawSignals:0,transitions:0,signals:0,invalidStopRejected:0,passed:{} as Record<string,number>};let prior=false;
  for(let i=248;i<four.length-1;i++){
   const f=breakoutV2Checks(four.slice(0,i+1));if(!f)throw new Error('Breakout warmup required');const raw=Object.values(f.checks).every(Boolean),transition=raw&&!prior;prior=raw;const time=four[i]!.timestamp+14400000;if(time<start)continue;
   row.decisions++;row.rawSignals+=Number(raw);row.transitions+=Number(transition);for(const[k,v]of Object.entries(f.checks))row.passed[k]=(row.passed[k]??0)+Number(v);
   if(transition){const tick=protocol.rules[d.symbol].priceTick,limit=floorTick(f.top*1.0015,tick),stop=floorTick(Math.min((f.top+f.bottom)/2-tick,limit-1.2*f.atr4h),tick);
    if(stop<=0||stop>=limit){row.invalidStopRejected++;continue;}signals.push({symbol:d.symbol,decisionTimestamp:four[i]!.timestamp,entryHour:time,limit,stop,atr4h:f.atr4h});row.signals++;
   }
  }funnel.push(row);
 }
 signals.sort((a,b)=>a.entryHour-b.entryHour||MAKER_CORE.indexOf(a.symbol as any)-MAKER_CORE.indexOf(b.symbol as any));return {signals,funnel};
}
