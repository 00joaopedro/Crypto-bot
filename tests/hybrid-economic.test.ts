import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { hybridEconomicDecisions,netRewardRisk } from '../src/hybrid-economic-options.js';
import { hybridDecisions,type HybridFeatures } from '../src/hybrid-research-signals.js';
import { replayHybridDecisions } from '../src/hybrid-research-replay.js';
import { runHybridEconomicStudy,screenEconomicCandidates } from '../src/hybrid-economic-study.js';
import { shadowConfiguration } from '../src/hybrid-shadow-session.js';
const json=(p:string)=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const plan=json('examples/hybrid-research.plan.json'),reference=json('examples/pullback-reference.study.json'),profile=json('examples/hybrid-shadow.profile.json'),config=shadowConfiguration(profile,plan,reference);
const f=():HybridFeatures=>({previous:{timestamp:0,open:100,close:99,high:100,low:98.9,volume:100},current:{timestamp:900000,open:99,close:100,high:101,low:98,volume:100},previousEma21:99,ema21:99.5,previousVwap:null,previousRsi14:45,rsi14:55,previousRsi7:20,previousVolumeRatio:1,previousLowerBand:99.5,lowerBand:99,sma20:102,adx14:20,atr14:1,previousAtr14:1,macroBullish:true});
it('keeps original signals unchanged by default and removes only the A volume gate',()=>{
 const original=f();expect(hybridEconomicDecisions(original)).toEqual(hybridDecisions(original));
 const a={...f(),previousVolumeRatio:2};expect(hybridDecisions(a).some(d=>d.strategy_mode==='TREND_PULLBACK')).toBe(false);
 expect(hybridEconomicDecisions(a,'A_VOLUME_OFF').some(d=>d.strategy_mode==='TREND_PULLBACK')).toBe(true);
 expect(hybridEconomicDecisions({...a,macroBullish:false},'A_VOLUME_OFF').some(d=>d.strategy_mode==='TREND_PULLBACK')).toBe(false);
 expect(hybridEconomicDecisions(a,'A_VOLUME_OFF').filter(d=>d.strategy_mode==='MEAN_REVERSION')).toEqual(hybridDecisions(a).filter(d=>d.strategy_mode==='MEAN_REVERSION'));expect(a.previousVolumeRatio).toBe(2);
});
it('changes only A touch tolerance and retains RSI, macro, volume and the B rules',()=>{
 const a=f();a.previous.low=98.3;expect(hybridDecisions(a).some(d=>d.strategy_mode==='TREND_PULLBACK')).toBe(false);
 expect(hybridEconomicDecisions(a,'A_TOUCH_1_ATR').some(d=>d.strategy_mode==='TREND_PULLBACK')).toBe(true);
 expect(hybridEconomicDecisions({...a,previousVolumeRatio:2},'A_TOUCH_1_ATR').some(d=>d.strategy_mode==='TREND_PULLBACK')).toBe(false);
 a.previous.low=97.9;expect(hybridEconomicDecisions(a,'A_TOUCH_1_ATR').some(d=>d.strategy_mode==='TREND_PULLBACK')).toBe(false);
});
it('removes only B ATR floor, refusing zero ATR and preserving its regime/exhaustion filters',()=>{
 const b={...f(),atr14:.2};expect(hybridDecisions(b)).toEqual([]);
 expect(hybridEconomicDecisions(b,'B_ATR_OFF').map(d=>d.strategy_mode)).toEqual(['MEAN_REVERSION']);
 expect(hybridEconomicDecisions({...b,adx14:22},'B_ATR_OFF')).toEqual([]);expect(hybridEconomicDecisions({...b,atr14:0},'B_ATR_OFF')).toEqual([]);
});
it('calculates RR using net quantity and cash outlay without subtracting entry fees twice',()=>{
 const cost=10,quantity=.0996,stop=98.8,target=103,fee=.004,slippage=.001;
 const r=netRewardRisk({cost,quantity,stop,target,fee,slippage});
 expect(r).toBeCloseTo((quantity*target*(1-fee)*(1-slippage)-cost)/(cost-quantity*stop*(1-fee)*(1-slippage)),12);
 expect(netRewardRisk({cost,quantity:.099,stop,target,fee,slippage})).toBeLessThan(r!);
 expect(netRewardRisk({cost,quantity,stop,target:99,fee,slippage})).toBeNull();expect(netRewardRisk({cost,quantity,stop,target,fee,slippage:2})).toBeNull();
});
it('documents the B target/stop incompatibility: even with zero costs its maximum RR is below 1.5',()=>{
 expect(netRewardRisk({cost:1,quantity:.01,stop:98.8,target:101.4,fee:0,slippage:0})).toBeCloseTo(1.4/1.2,10);
 expect(1.4/1.2).toBeLessThan(1.5);
});
it('RR hypothesis rejects uneconomic B admission while preserving default replay and all risk limits',()=>{
 const data=[{symbol:'BTC/USDT',constraints:{minimumNotionalUsdt:0,minimumQuantity:.0001,quantityStep:.0001},candles1h:[],quoteVolumesUsdt:[2e6,2e6,2e6],candles15m:Array.from({length:3},(_,i)=>({timestamp:i*900000,open:100,high:100.1,low:99.9,close:100,volume:20000}))}];
 const signals=new Map([['BTC/USDT',[[{strategy_mode:'MEAN_REVERSION' as const,decisionTimestamp:0,atr:1,pullbackLow:99,sma20:105}]]]]);
 const scenario={name:'test',feeRate:.004,slippageRate:.001,spreadRate:.0015,assumedDepthUsdt:1000,maxParticipationRate:.001,symbolCosts:{'BTC/USDT':{feeRate:.004,slippageRate:.001,spreadRate:.0015,entryFeeCurrency:'base' as const}}};
 const run=(hypothesis?:'B_NET_RR_1_5')=>replayHybridDecisions(data,signals,plan,scenario,config.reference.parameters,1,config.profile.riskLimits,undefined,hypothesis);
 const base=run();expect(base.entries).toHaveLength(1);const gated=run('B_NET_RR_1_5');expect(gated.entries).toHaveLength(0);expect(gated.rejected.net_rr_decision).toBe(1);expect(run()).toEqual(base);expect(gated.realMoneyApproved).toBe(false);
});
it('rejects another dataset instead of silently testing a new period or tuning protocol parameters',()=>{
 expect(()=>runHybridEconomicStudy({asOfUtc:'2026-11-22T23:00:00Z',instruments:[]},plan,reference,profile,{runs:[]})).toThrow();
 expect(()=>hybridEconomicDecisions(f(),'unknown' as any)).toThrow();
});

it('screens both unique cost cases, rejects small samples/null PF/negative blocks, and never promotes a configuration',()=>{
 const r={name:'A_VOLUME_OFF',scenario:'account-conditioned',closedTrades:30,expectancyUsdt:.01,profitFactor:1.2,netReturnUsdt:.3,blocks:Array.from({length:3},()=>({complete:true,netReturnUsdt:.1}))};
 const approved=(runs:any[])=>screenEconomicCandidates(runs).find(s=>s.name===r.name)!.eligibleForFutureIndependentProtocol;
 expect(approved([r,{...r,scenario:'account-cost-stress'}])).toBe(true);expect(approved([r,r])).toBe(false);expect(approved([r])).toBe(false);
 for(const change of [{closedTrades:Infinity},{closedTrades:29},{profitFactor:null},{expectancyUsdt:0},{netReturnUsdt:0},{profitFactor:Infinity},{blocks:[{complete:true,netReturnUsdt:-.1}]}])expect(approved([r,{...r,...change,scenario:'account-cost-stress'}])).toBe(false);
});
