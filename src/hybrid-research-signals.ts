import { z } from "zod";
import { averageTrueRange,emaSeries,rsiSeries } from "./indicators.js";
import type { Candle } from "./types.js";
export const HYBRID_WATCHLIST=Object.freeze(['BTC/USDT','ETH/USDT','SOL/USDT','XRP/USDT','DOGE/USDT','SUI/USDT','NEAR/USDT','AVAX/USDT','LINK/USDT','DOT/USDT','AAVE/USDT','LTC/USDT','UNI/USDT','ATOM/USDT','APT/USDT','ARB/USDT','OP/USDT','FIL/USDT','INJ/USDT','TON/USDT']);
export const hybridPlanSchema=z.object({
 protocol:z.literal('hybrid-research-v1'),engine:z.literal('pullback_mean_reversion'),timeframe:z.literal('15m'),bankUsdt:z.literal(17),lotUsdt:z.literal(10),maxConcurrentPositions:z.literal(1),
 allocationPolicy:z.literal('fixed_lot_cash_and_one_position'),warmup15m:z.literal(1000),warmup1h:z.literal(250),atrFloorRate:z.literal(.007),touchToleranceAtr:z.literal(.25),
 atrMethod:z.literal('simple_true_range_mean_14'),vwapDay:z.literal('UTC'),profitBasis:z.literal('estimated_net_after_costs'),stopA:z.literal('closer_of_entry_1.1_percent_and_pullback_low_minus_1.5_atr'),
 activationA:z.literal(.012),floorA:z.literal(.007),trailingAtrA:z.literal(1.2),targetA:z.literal(.028),targetB:z.literal(.014),stopB:z.literal(.012),timeStopB:z.literal(6),
 tieBreak:z.literal('watchlist_order_then_A'),watchlist:z.array(z.string()).length(20),baselineStudySha256:z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(p=>JSON.stringify(p.watchlist)===JSON.stringify(HYBRID_WATCHLIST),'Frozen watchlist required');
export type HybridPlan=z.infer<typeof hybridPlanSchema>;
export type HybridMode='TREND_PULLBACK'|'MEAN_REVERSION';
export type ResearchMode=HybridMode|'BASELINE';
export type HybridDecision={strategy_mode:ResearchMode;decisionTimestamp:number;atr:number;pullbackLow:number;sma20:number};
export type HybridFeatures={previous:Candle;current:Candle;previousEma21:number;ema21:number;previousVwap:number|null;previousRsi14:number;rsi14:number;previousRsi7:number;previousVolumeRatio:number;previousLowerBand:number;lowerBand:number;sma20:number;adx14:number;atr14:number;previousAtr14:number;macroBullish:boolean};
const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;
function band(closes:number[]){const window=closes.slice(-20),center=mean(window);return {center,lower:center-2*Math.sqrt(mean(window.map(p=>(p-center)**2)))};}
/** Wilder directional movement, Wilder ADX14. Flat markets produce zero, never NaN. */
export function researchAdx(candles:Candle[],period=14):number|null{
 if(candles.length<2*period)return null;
 const tr:number[]=[],plus:number[]=[],minus:number[]=[];
 for(let i=1;i<candles.length;i++){
  const c=candles[i]!,p=candles[i-1]!,up=c.high-p.high,down=p.low-c.low;
  tr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));plus.push(up>down&&up>0?up:0);minus.push(down>up&&down>0?down:0);
 }
 let t=tr.slice(0,period).reduce((a,b)=>a+b,0),p=plus.slice(0,period).reduce((a,b)=>a+b,0),m=minus.slice(0,period).reduce((a,b)=>a+b,0),adx:number|undefined;
 const dx:number[]=[];
 for(let i=period-1;i<tr.length;i++){
  if(i>=period){t=t-t/period+tr[i]!;p=p-p/period+plus[i]!;m=m-m/period+minus[i]!;}
  const value=t>0&&p+m>0?100*Math.abs(p-m)/(p+m):0;
  dx.push(value);if(dx.length===period)adx=mean(dx);else if(dx.length>period)adx=(adx!*(period-1)+value)/period;
 }
 return adx??null;
}
export function utcResearchVwap(candles:Candle[]):number|null{
 const last=candles.at(-1);if(!last)return null;
 const day=Math.floor(last.timestamp/86400000)*86400000,within=candles.filter(c=>c.timestamp>=day);
 if(within[0]?.timestamp!==day)return null;
 const volume=within.reduce((s,c)=>s+c.volume,0);return volume>0?within.reduce((s,c)=>s+(c.high+c.low+c.close)/3*c.volume,0)/volume:null;
}
/** Only fully closed hours whose END is <= the decision's close are used. */
export function hybridFeatures(history15m:Candle[],hours:Candle[]):HybridFeatures|null{
 if(history15m.length<84)return null;
 const current=history15m.at(-1)!,previous=history15m.at(-2)!,closes=history15m.map(c=>c.close),ema21=emaSeries(closes,21),r14=rsiSeries(closes,14),r7=rsiSeries(closes,7);
 const closedHours=hours.filter(c=>c.timestamp+3600000<=current.timestamp+900000),hourCloses=closedHours.map(c=>c.close);
 const prevBand=band(closes.slice(0,-1)),nowBand=band(closes),adx14=researchAdx(history15m);
 if(adx14===null)return null;
 const previousVolumes=history15m.slice(-22,-2).map(c=>c.volume),average=mean(previousVolumes);
 return {previous,current,previousEma21:ema21.at(-2)!,ema21:ema21.at(-1)!,previousVwap:utcResearchVwap(history15m.slice(0,-1)),previousRsi14:r14.at(-2)!,rsi14:r14.at(-1)!,previousRsi7:r7.at(-2)!,previousVolumeRatio:average>0?previous.volume/average:Infinity,previousLowerBand:prevBand.lower,lowerBand:nowBand.lower,sma20:nowBand.center,adx14,atr14:averageTrueRange(history15m,14),previousAtr14:averageTrueRange(history15m.slice(0,-1),14),macroBullish:closedHours.length>=250&&emaSeries(hourCloses,50).at(-1)!>emaSeries(hourCloses,200).at(-1)!};
}
export function hybridDecisions(f:HybridFeatures):HybridDecision[]{
 if(!Number.isFinite(f.atr14)||f.atr14<=0||f.atr14/f.current.close<.007)return [];
 const decision=(strategy_mode:HybridMode):HybridDecision=>({strategy_mode,decisionTimestamp:f.current.timestamp,atr:f.atr14,pullbackLow:f.previous.low,sma20:f.sma20});
 const touch=(level:number|null)=>level!==null&&Number.isFinite(level)&&f.previous.low<=level&&f.previous.low>=level-.25*f.previousAtr14;
 const result:HybridDecision[]=[];
 if(f.macroBullish&&(touch(f.previousEma21)||touch(f.previousVwap))&&f.previousRsi14>=40&&f.previousRsi14<=50&&f.previousVolumeRatio<1.1&&f.current.close>f.current.open&&f.current.close>f.ema21&&f.rsi14<=58)result.push(decision('TREND_PULLBACK'));
 if(f.adx14<22&&f.previous.close<f.previousLowerBand&&f.previousRsi7<25&&f.current.close>f.current.open&&f.current.close>f.lowerBand)result.push(decision('MEAN_REVERSION'));
 return result;
}
