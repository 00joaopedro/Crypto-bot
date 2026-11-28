import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { compressionChecks,compressionAtrSeries } from '../src/compression-retest.js';
import { compressionTrailUpdate } from '../src/compression-trailing.js';
import { aggregateFourHours } from '../src/trend-horizon.js';
import { averageTrueRange } from '../src/indicators.js';
import { replayMakerPullback,type MakerSignal,type MakerMicro } from '../src/maker-pullback.js';
import type { HybridInstrument } from '../src/hybrid-research-replay.js';
const protocol=JSON.parse(readFileSync(new URL('../examples/compression-retest.plan.json',import.meta.url),'utf8'));
const bars=(n:number)=>Array.from({length:n},(_,i)=>({timestamp:i*3600000,open:100+i*.1,high:100.2+i*.1,low:99.9+i*.1,close:100.15+i*.1,volume:100}));
function setup(){const h=bars(1008);h[999]={...h[999]!,open:200,close:202,high:203,low:199,volume:200};const atr=Array(1008).fill(1) as number[];for(let i=995;i<=998;i++)atr[i]=.5;return {h,atr,four:aggregateFourHours(h)};}
it('aligns each simpleATR14 to known candles only, ignoring future prices',()=>{
 const h=bars(100),a=compressionAtrSeries(h);for(let i=14;i<100;i++)expect(a[i]).toBeCloseTo(averageTrueRange(h.slice(0,i+1),14));h[90]!.high=1000;expect(compressionAtrSeries(h).slice(0,90)).toEqual(a.slice(0,90));
});
it('uses four prior compressed ATRs and the previous12-bar range, excluding breakout high and ATR',()=>{
 const f=setup(),q=compressionChecks(f.h.slice(0,1000),f.four,f.atr)!;expect(Object.values(q.checks).every(Boolean)).toBe(true);expect(q.upper).toBe(f.h[998]!.high);expect(q.previousAtr).toBe(.5);
 f.h[999]!.high=1000;f.atr[999]=100;expect(compressionChecks(f.h.slice(0,1000),f.four,f.atr)!.checks).toEqual(q.checks);
 f.atr[995]=1;expect(compressionChecks(f.h.slice(0,1000),f.four,f.atr)!.checks.compression).toBe(false);
});
it('requires macro warmup, genuine closing breakout, volume and bullish displacement',()=>{
 const f=setup();expect(compressionChecks(f.h.slice(0,999),f.four,f.atr)).toBeNull();const q=compressionChecks(f.h.slice(0,1000),f.four,f.atr)!;
 f.h[999]!.close=q.upper;f.h[999]!.open=q.upper;f.h[999]!.volume=100;const bad=compressionChecks(f.h.slice(0,1000),f.four,f.atr)!;expect(bad.checks).toMatchObject({breakout:false,volume:false,displacement:false});
});
it('ignores future4h context and future ATR observations',()=>{
 const f=setup(),q=compressionChecks(f.h.slice(0,1000),f.four,f.atr);for(let i=250;i<f.four.length;i++)f.four[i]!.close=1;for(let i=1000;i<f.atr.length;i++)f.atr[i]=1000;expect(compressionChecks(f.h.slice(0,1000),f.four,f.atr)).toEqual(q);
});
const trail={armed:false,stop:95,initialStop:95,peakClose:100,close:111,atr:2,quantity:.999,cost:100,taker:.004,friction:.00175,tick:.1};
it('arms on2R net, not2R gross, and never lowers a trailing stop',()=>{
 expect(compressionTrailUpdate(trail).armed).toBe(false);const a=compressionTrailUpdate({...trail,close:115});expect(a).toMatchObject({armed:true,stop:111,peakClose:115});
 expect(compressionTrailUpdate({...trail,...a,close:114,atr:10}).stop).toBe(111);
});
it('does not retroactively accept a crossed proposal or invalid ATR',()=>{
 expect(compressionTrailUpdate({...trail,armed:true,peakClose:120,close:110,atr:2}).stop).toBe(95);expect(()=>compressionTrailUpdate({...trail,atr:NaN})).toThrow(/Valid/);
});
function replayFixture(){
 const time=1000*3600000,h=Array.from({length:3160},(_,i)=>({timestamp:i*3600000,open:101,high:101.5,low:100.5,close:101,volume:6000}));
 const data={instruments:['BTC/USDT','ETH/USDT','SOL/USDT'].map(symbol=>({symbol,candles15m:h.map(c=>({...c})),candles1h:[],constraints:{minimumQuantity:.00001,quantityStep:1e-8,minimumNotionalUsdt:0}})) as HybridInstrument[]};
 const signals:MakerSignal[]=[{symbol:'BTC/USDT',decisionTimestamp:time-3600000,entryHour:time,limit:100,stop:95,target:115}];
 const m=Array.from({length:60},(_,i)=>({timestamp:time+i*60000,open:101,high:101.5,low:100.5,close:101,volume:100}));m[0]!.low=99.8;m[59]={...m[59]!,close:114,high:114.2};
 const entry=data.instruments[0]!.candles15m[1000]!;entry.low=99.8;entry.high=114.2;entry.close=114;
 data.instruments[0]!.candles15m[1001]={...data.instruments[0]!.candles15m[1001]!,open:114,high:114.5,low:100,close:114};
 const micro:MakerMicro={windows:[{symbol:'BTC/USDT',hour:time,candles:m}],missing:[],publicRulesMatched:true};return {data,signals,micro,time};
}
it('applies a raised stop only after the activation hour has completed; old fixed exits remain isolated',()=>{
 const f=replayFixture(),r=replayMakerPullback(f.data,f.signals,f.micro,protocol,protocol.scenarios[0],'compression');if(!('closedTradeLedger'in r))throw new Error('Expected ledger');
 expect(r.closedTradeLedger).toHaveLength(1);expect(r.closedTradeLedger[0]!.reason).toBe('TRAILING_STOP');expect(r.closedTradeLedger[0]!.exitTimestamp).toBe(f.time+3600000);
 const update=r.events.find(e=>e.type==='trailing_stop_updated')!;expect(update.effectiveFrom).toBe(f.time+3600000);expect(r.closedTradeLedger[0]!.exitPrice).toBeLessThan(Number(update.newStop));
 const old=replayMakerPullback(f.data,f.signals,f.micro,protocol,protocol.scenarios[0]);expect(old.closedTrades).toBe(0);
});
it('retains gap protection after trailing arms and requires explicit exit-policy selection',()=>{
 const f=replayFixture();f.data.instruments[0]!.candles15m[1001]={...f.data.instruments[0]!.candles15m[1001]!,open:108,low:107};
 const r=replayMakerPullback(f.data,f.signals,f.micro,protocol,protocol.scenarios[0],'compression');if(!('closedTradeLedger'in r))throw new Error('Expected ledger');expect(r.closedTradeLedger[0]!.exitPrice).toBeCloseTo(108*(1-(1.001*1.00075-1)));
 expect(()=>replayMakerPullback(f.data,f.signals,f.micro,protocol,protocol.scenarios[0],'invalid' as any)).toThrow(/Explicit/);
});
