import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { hybridPlanSchema,HYBRID_WATCHLIST,hybridDecisions,hybridFeatures,researchAdx,utcResearchVwap,type HybridFeatures } from '../src/hybrid-research-signals.js';
const candle=(timestamp:number,price:number)=>({timestamp,open:price,high:price+1,low:price-1,close:price,volume:100});
const features=():HybridFeatures=>({previous:{...candle(0,99),open:99.5,low:98.9},current:{...candle(900000,100),open:99.5},previousEma21:99,ema21:99.7,previousVwap:null,previousRsi14:45,rsi14:55,previousRsi7:40,previousVolumeRatio:1,previousLowerBand:98.5,lowerBand:99,sma20:102,adx14:30,atr14:1,previousAtr14:1,macroBullish:true});
it('freezes all twenty pairs and rejects stablecoins/synthetics or undeclared parameter tuning',()=>{
 const plan=JSON.parse(readFileSync(new URL('../examples/hybrid-research.plan.json',import.meta.url),'utf8'));
 expect(hybridPlanSchema.parse(plan).watchlist).toEqual(HYBRID_WATCHLIST);expect(HYBRID_WATCHLIST).toHaveLength(20);expect(HYBRID_WATCHLIST).not.toContain('USDC/USDT');expect(HYBRID_WATCHLIST).not.toContain('XNVDA/USDT');
 expect(()=>hybridPlanSchema.parse({...plan,atrFloorRate:.008})).toThrow();expect(()=>hybridPlanSchema.parse({...plan,watchlist:[...plan.watchlist.slice(1),'USDC/USDT']})).toThrow();
});
it('implements Trend Pullback with previous-bar RSI/volume/touch and current green EMA recovery',()=>{
 expect(hybridDecisions(features()).map(s=>s.strategy_mode)).toEqual(['TREND_PULLBACK']);
 for(const change of [{macroBullish:false},{previousRsi14:39.9},{previousRsi14:50.01},{previousVolumeRatio:1.1},{rsi14:58.01},{atr14:.69}])expect(hybridDecisions({...features(),...change})).toEqual([]);
 const f=features();f.previous.low=98.7;expect(hybridDecisions(f)).toEqual([]);f.previousVwap=98.8;expect(hybridDecisions(f)).toHaveLength(1);
});
it('Mean Reversion requires RSI7<25 only on t-1 and ADX<22, without inheriting trend-context or confirmation-RSI gates',()=>{
 const f={...features(),macroBullish:false,previousRsi14:10,previousRsi7:24.99,rsi14:80,adx14:21.99,previous:{...candle(0,98),low:97}};
 expect(hybridDecisions(f).map(s=>s.strategy_mode)).toEqual(['MEAN_REVERSION']);expect(hybridDecisions({...f,previousRsi7:25})).toEqual([]);expect(hybridDecisions({...f,adx14:22})).toEqual([]);
 const red={...f,current:{...f.current,open:101}};expect(hybridDecisions(red)).toEqual([]);
});
it('computes Wilder ADX for directional and flat streams, with the correct warmup boundary',()=>{
 const up=Array.from({length:100},(_,i)=>candle(i*900000,100+i));expect(researchAdx(up.slice(0,27))).toBeNull();expect(researchAdx(up.slice(0,28))).toBeCloseTo(100,12);expect(researchAdx(up)).toBeCloseTo(100,12);
 expect(researchAdx(up.map(c=>({...c,open:100,high:101,low:99,close:100})))).toBe(0);
});
it('VWAP resets at UTC midnight and refuses a truncated intraday history',()=>{
 const first={...candle(0,100),volume:2},second={...candle(900000,106),volume:1};expect(utcResearchVwap([first,second])).toBe(102);expect(utcResearchVwap([second])).toBeNull();expect(utcResearchVwap([first,second,candle(86400000,200)])).toBe(200);
});
it('ignores the open/future hour and requires 250 closed hours for macro EMA50/200',()=>{
 const bars=Array.from({length:1001},(_,i)=>candle(i*900000,100));
 const hours=Array.from({length:251},(_,i)=>candle(i*3600000,100+i));
 const before=hybridFeatures(bars,hours)!;expect(before.macroBullish).toBe(true);
 hours[250]={...candle(250*3600000,1),low:.1};expect(hybridFeatures(bars,hours)).toEqual(before);
 expect(hybridFeatures(bars,hours.slice(0,249))!.macroBullish).toBe(false);
});
