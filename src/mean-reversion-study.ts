import { rsiSeries } from "./indicators.js";
import type { Candle } from "./types.js";
/** Fixed research hypothesis; never wired to live execution. */
export const MEAN_REVERSION_HYPOTHESIS = Object.freeze({ bandPeriod:20, bandDeviations:2, rsiPeriod:14, maximumRsi:35, maximumBandwidthRate:.04 });
export function meanReversionEntry(candles: readonly Candle[]): boolean {
 if(candles.length<84||candles.some(c=>!Number.isFinite(c.close)||c.close<=0))return false;
 const closes=candles.map(c=>c.close), recent=closes.slice(-20);
 const mean=recent.reduce((a,b)=>a+b,0)/20;
 const deviation=Math.sqrt(recent.reduce((a,b)=>a+(b-mean)**2,0)/20);
 if(deviation===0||4*deviation/mean>.04)return false;
 const rsi=rsiSeries(closes,14).at(-1);
 return rsi!==undefined&&Number.isFinite(rsi)&&rsi<35&&closes.at(-1)!<=mean-2*deviation;
}
