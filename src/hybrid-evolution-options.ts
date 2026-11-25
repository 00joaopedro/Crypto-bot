import { z } from 'zod';
import { emaSeries,averageTrueRange } from './indicators.js';
import { researchAdx,type HybridFeatures,type HybridDecision } from './hybrid-research-signals.js';
import { netRewardRisk } from './hybrid-economic-options.js';
import type { Candle } from './types.js';

export const evolutionReplaySchema=z.enum(['roi','full','squeeze','horizon','horizon_reference']);
export type EvolutionReplay=z.infer<typeof evolutionReplaySchema>;
export type EvolutionChange='reference'|'transition'|'regime'|'roi'|'full'|'squeeze';
export function closedHourRegime(hours:readonly Candle[],decisionClose:number){
 const closed=hours.filter(c=>c.timestamp+3600000<=decisionClose);
 if(closed.length<250)return {trend:false,lateral:false,adx:null,slope:null};
 const closes=closed.map(c=>c.close),fast=emaSeries(closes,50),slow=emaSeries(closes,200),adx=researchAdx(closed),last=fast.at(-1)!,slope=last/fast.at(-4)!-1;
 return {trend:adx!==null&&adx>=22&&last>slow.at(-1)!&&last>fast.at(-2)!,lateral:adx!==null&&adx<20&&Math.abs(slope)<=.003,adx,slope};
}
/** Called using elapsed minutes at a candle's OPEN, never after observing its high. */
export function evolutionNetRoi(elapsedMinutes:number){
 if(!Number.isFinite(elapsedMinutes)||elapsedMinutes<0)throw new Error('Valid holding age required');
 return elapsedMinutes>=180?.006:elapsedMinutes>=30?.011:.016;
}
export function evolutionQuoteGate(q:{cost:number;quantity:number;fill:number;referencePrice:number;stop:number;target:number;fee:number;slippage:number}){
 const rr=netRewardRisk(q),netGain=q.quantity*q.target*(1-q.fee)*(1-q.slippage)-q.cost;
 const totalCosts=q.cost-q.quantity*q.referencePrice*(1-q.fee)*(1-q.slippage);
 if(!(q.stop>0&&q.stop<q.fill&&q.target>q.fill)||![q.fill,q.referencePrice,totalCosts,netGain].every(Number.isFinite)||q.referencePrice<=0||totalCosts<0||rr===null||rr<.5)return 'net_reward_risk';
 return netGain<.5*totalCosts?'net_gain_cost_margin':null;
}
export function squeezeDecision(history:readonly Candle[],f:HybridFeatures,regime:ReturnType<typeof closedHourRegime>):HybridDecision[]{
 if(history.length<84||!regime.trend||!Number.isFinite(f.atr14)||!Number.isFinite(f.current.close)||f.current.close<=0||f.atr14/f.current.close<.007||f.atr14<=0)return [];
 const previous=history.slice(0,-1),closes=previous.map(c=>c.close),window=closes.slice(-20),mean=window.reduce((a,b)=>a+b,0)/20;
 const sigma=Math.sqrt(window.reduce((a,b)=>a+(b-mean)**2,0)/20),center=emaSeries(closes,20).at(-1)!,atr=averageTrueRange(previous,20);
 const squeeze=mean-2*sigma>center-1.5*atr&&mean+2*sigma<center+1.5*atr;
 const currentCloses=history.slice(-20).map(c=>c.close),nowMean=currentCloses.reduce((a,b)=>a+b,0)/20,upper=nowMean+2*Math.sqrt(currentCloses.reduce((a,b)=>a+(b-nowMean)**2,0)/20);
 const volume=previous.slice(-20).reduce((a,c)=>a+c.volume,0)/20;
 return squeeze&&f.previous.close<=mean+2*sigma&&f.current.close>upper&&f.current.close>f.current.open&&volume>0&&f.current.volume/volume>=1.5?[{strategy_mode:'VOLATILITY_SQUEEZE',decisionTimestamp:f.current.timestamp,atr:f.atr14,pullbackLow:f.previous.low,sma20:f.sma20}]:[];
}

export function horizonQuoteGate(q:{cost:number;quantity:number;fill:number;referencePrice:number;stop:number;target:number;fee:number;slippage:number}){
 const rr=netRewardRisk(q),gain=q.quantity*q.target*(1-q.fee)*(1-q.slippage)-q.cost,cost=q.cost-q.quantity*q.referencePrice*(1-q.fee)*(1-q.slippage);
 return q.stop>0&&q.stop<q.fill&&rr!==null&&rr>=1&&Number.isFinite(cost)&&cost>=0&&gain>=cost;
}
