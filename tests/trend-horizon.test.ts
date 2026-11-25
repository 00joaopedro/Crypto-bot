import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { aggregateFourHours,horizonFeatures } from '../src/trend-horizon.js';
import { horizonQuoteGate } from '../src/hybrid-evolution-options.js';
import { replayHybridDecisions } from '../src/hybrid-research-replay.js';
import { shadowConfiguration } from '../src/hybrid-shadow-session.js';
const json=(p:string)=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const config=shadowConfiguration(json('examples/hybrid-shadow.profile.json'),json('examples/hybrid-research.plan.json'),json('examples/pullback-reference.study.json'));
const bars=(n:number)=>Array.from({length:n},(_,i)=>({timestamp:i*3600000,open:100+i*.01,high:101+i*.01,low:99+i*.01,close:100+i*.01,volume:100}));
it('derives aligned4h only from four contiguous hours, handling zero-volume open/high/low',()=>{
 const h=bars(8),a=aggregateFourHours(h);expect(a).toHaveLength(2);expect(a[0]).toMatchObject({timestamp:0,volume:400,open:100,close:100.03});
 expect(()=>aggregateFourHours(h.slice(1))).toThrow(/UTC4h/);expect(()=>aggregateFourHours(h.slice(0,7))).toThrow(/UTC4h/);
 h[0]!.volume=0;h[0]!.high=200;expect(aggregateFourHours(h)[0]!.open).toBe(h[1]!.open);expect(aggregateFourHours(h)[0]!.high).toBeLessThan(200);
});
it('requires250fully closed4h bars and ignores future context',()=>{
 const h=bars(1016),four=aggregateFourHours(h);expect(horizonFeatures(h.slice(0,999),four)).toBeNull();
 const f=horizonFeatures(h.slice(0,1000),four);expect(f?.macroBullish).toBe(true);for(let i=250;i<four.length;i++)four[i]!.close=1;expect(horizonFeatures(h.slice(0,1000),four)).toEqual(f);
});
it('requires net RR>=1 and net reward covering modeled costs without treating it as statistical EV',()=>{
 const q={cost:1,quantity:.00996,fill:100.1,referencePrice:100,stop:98,target:105,fee:.004,slippage:.001};expect(horizonQuoteGate(q)).toBe(true);expect(horizonQuoteGate({...q,target:101})).toBe(false);expect(horizonQuoteGate({...q,stop:110})).toBe(false);
});
it('isolates1h replay, freezes ATR exits at the previous signal and keeps stop-first/gap protection',()=>{
 const h=bars(5).map(c=>({...c,open:100,high:100.1,low:99.9,close:100})),d=[{symbol:'BTC/USDT',candles15m:h,candles1h:[],constraints:{minimumNotionalUsdt:0,minimumQuantity:.0001,quantityStep:.0001}}],map=new Map([['BTC/USDT',[[{strategy_mode:'TREND_PULLBACK' as const,decisionTimestamp:0,atr:2,pullbackLow:99,sma20:100}]]]]),scenario={name:'zero',feeRate:0,slippageRate:0,spreadRate:0,assumedDepthUsdt:1000,maxParticipationRate:.001};
 expect(()=>replayHybridDecisions(d,map,config.strategy,scenario,config.reference.parameters,1,undefined,undefined,undefined,undefined,3600000)).toThrow(/Explicit horizon/);
 h[2]={timestamp:7200000,open:95,high:110,low:94,close:100,volume:100};
 const r=replayHybridDecisions(d,map,config.strategy,scenario,config.reference.parameters,1,config.profile.riskLimits,undefined,undefined,'horizon',3600000);
 expect(r.entries[0]).toMatchObject({stopPrice:97,targetPrice:106});expect(r.closedTradeLedger[0]).toMatchObject({reason:'STOP_LOSS',exitPrice:95,holdingCandles:2});expect(r.blocks[0]!.name).toBe('D1-D30');expect(r.realMoneyApproved).toBe(false);
});
