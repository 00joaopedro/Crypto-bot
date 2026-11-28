import { z } from 'zod';
import { hybridSignalChecks,hybridDecisions,type HybridFeatures,type HybridDecision } from './hybrid-research-signals.js';
export const hybridEconomicHypothesisSchema=z.enum(['A_VOLUME_OFF','A_TOUCH_1_ATR','B_NET_RR_1_5','B_ATR_OFF']);
export type HybridEconomicHypothesis=z.infer<typeof hybridEconomicHypothesisSchema>;
/** Only explicit offline callers use this. Original signal rules remain the default. */
export function hybridEconomicDecisions(f:HybridFeatures,hypothesis?:HybridEconomicHypothesis):HybridDecision[]{
 if(hypothesis===undefined)return hybridDecisions(f);
 const h=hybridEconomicHypothesisSchema.parse(hypothesis),checks=hybridSignalChecks(f);
 if(!Number.isFinite(f.atr14)||f.atr14<=0)return [];
 if(h==='A_VOLUME_OFF')checks.TREND_PULLBACK.volume=true;
 if(h==='A_TOUCH_1_ATR'){
  const touch=(v:number|null)=>v!==null&&Number.isFinite(v)&&f.previous.low<=v&&f.previous.low>=v-f.previousAtr14;
  checks.TREND_PULLBACK.touch=touch(f.previousEma21)||touch(f.previousVwap);
 }
 if(h==='B_ATR_OFF')checks.MEAN_REVERSION.atr=true;
 return (['TREND_PULLBACK','MEAN_REVERSION']as const).filter(mode=>Object.values(checks[mode]).every(Boolean)).map(strategy_mode=>({strategy_mode,decisionTimestamp:f.current.timestamp,atr:f.atr14,pullbackLow:f.previous.low,sma20:f.sma20}));
}
export function netRewardRisk(input:{cost:number;quantity:number;stop:number;target:number;fee:number;slippage:number}):number|null{
 const {cost,quantity,stop,target,fee,slippage}=input;
 if(![cost,quantity,stop,target].every(v=>Number.isFinite(v)&&v>0)||![fee,slippage].every(v=>Number.isFinite(v)&&v>=0&&v<1))return null;
 const proceeds=(price:number)=>quantity*price*(1-fee)*(1-slippage),reward=proceeds(target)-cost,loss=cost-proceeds(stop);
 return reward>0&&loss>0?reward/loss:null;
}
