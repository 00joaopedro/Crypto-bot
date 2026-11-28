import { emaSeries,averageTrueRange } from './indicators.js';
import { aggregateFourHours } from './trend-horizon.js';
import { MAKER_CORE,validateMakerBars,type MakerSignal } from './maker-pullback.js';
import { quantizeQuantityDown } from './decimal-quantity.js';
import { semanticHash } from './cost-experiments.js';
import type { HybridInstrument } from './hybrid-research-replay.js';
import type { Candle } from './types.js';
/** ATR series aligned with candles; no observations after index i enter its ATR. */
export function compressionAtrSeries(hours:Candle[]){
 return hours.map((_,i)=>i<14?0:averageTrueRange(hours.slice(i-14,i+1),14));
}
export function compressionChecks(history:Candle[],four:Candle[],knownAtr?:number[]){
 if(history.length<84)return null;const current=history.at(-1)!,closed=four.filter(c=>c.timestamp+14400000<=current.timestamp+3600000);if(closed.length<250)return null;
 const fast=emaSeries(closed.map(c=>c.close),50),slow=emaSeries(closed.map(c=>c.close),200),atr=knownAtr??compressionAtrSeries(history),i=history.length-1;
 if(atr.length<history.length)throw new Error('ATR clock mismatch');
 const range=history.slice(-13,-1),upper=Math.max(...range.map(c=>c.high)),lower=Math.min(...range.map(c=>c.low)),previousAtr=atr[i-1]!,volume=history.slice(-21,-1).reduce((s,c)=>s+c.volume,0)/20;
 const compressed=[1,2,3,4].every(k=>{const j=i-k,baseline=atr.slice(j-50,j),mean=baseline.reduce((s,n)=>s+n,0)/50;return baseline.length===50&&mean>0&&atr[j]!>0&&atr[j]!<.75*mean;});
 return {upper,lower,previousAtr,checks:{regime:fast.at(-1)!>slow.at(-1)!&&[1,2,3].every(k=>fast.at(-k)!>fast.at(-k-1)!),compression:compressed,breakout:current.close>upper,volume:volume>0&&current.volume>=1.5*volume,displacement:previousAtr>0&&current.close-current.open>=.5*previousAtr,atr_valid:Number.isFinite(previousAtr)&&previousAtr>0}};
}
export function scanCompressionRetests(data:{instruments:HybridInstrument[]},protocol:any){
 const signals:MakerSignal[]=[],funnel=[];
 for(const symbol of MAKER_CORE){
  const matches=data.instruments.filter(d=>d.symbol===symbol);if(matches.length!==1)throw new Error('Distinct compression core required');const d=matches[0]!,hours=d.candles15m;
  validateMakerBars(hours,3600000);if(hours.length!==3160||hours[1000]!.timestamp!==Date.parse(protocol.window.evaluationStartUtc)||hours.at(-1)!.timestamp+3600000!==Date.parse(protocol.window.endExclusiveUtc))throw new Error('Frozen compression window mismatch');
  const four=aggregateFourHours(hours),atr=compressionAtrSeries(hours),rules=protocol.rules[symbol],row={symbol,decisions:0,rawSignals:0,transitions:0,signals:0,passed:{} as Record<string,number>};let prior=false;
  for(let i=999;i<hours.length-1;i++){
   const f=compressionChecks(hours.slice(0,i+1),four,atr);if(!f)throw new Error('Compression warmup required');const current=Object.values(f.checks).every(Boolean),transition=current&&!prior;prior=current;
   if(i<1000)continue;row.decisions++;row.rawSignals+=Number(current);row.transitions+=Number(transition);for(const[k,v]of Object.entries(f.checks))row.passed[k]=(row.passed[k]??0)+Number(v);
   if(transition){const limit=quantizeQuantityDown(f.upper,1,rules.priceTick).quantity,rawStop=f.lower-.25*f.previousAtr;if(rawStop<=0)continue;const stop=quantizeQuantityDown(rawStop,1,rules.priceTick).quantity,target=quantizeQuantityDown(limit+3*(limit-stop),1,rules.priceTick).quantity;
    if(stop>0&&stop<limit&&target>limit){signals.push({symbol,decisionTimestamp:hours[i]!.timestamp,entryHour:hours[i+1]!.timestamp,limit,stop,target});row.signals++;}
   }
  }funnel.push(row);
 }
 signals.sort((a,b)=>a.entryHour-b.entryHour||MAKER_CORE.indexOf(a.symbol as typeof MAKER_CORE[number])-MAKER_CORE.indexOf(b.symbol as typeof MAKER_CORE[number]));return {signals,funnel};
}
export function compressionSource(data:{instruments:HybridInstrument[]},protocol:any){if(protocol.protocol!=='compression-retest-development-v1'||semanticHash(data)!==protocol.sourceDatasetSha256||JSON.stringify(protocol.universe)!==JSON.stringify(MAKER_CORE))throw new Error('Frozen compression source mismatch');return scanCompressionRetests(data,protocol);}
