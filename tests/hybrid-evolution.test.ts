import { readFileSync } from 'node:fs';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect,it } from 'vitest';
import { closedHourRegime,evolutionNetRoi,evolutionQuoteGate,squeezeDecision } from '../src/hybrid-evolution-options.js';
import { transitionDecisions,screenEvolution,runHybridEvolution } from '../src/hybrid-evolution-study.js';
import { replayHybridDecisions,type HybridInstrument } from '../src/hybrid-research-replay.js';
import { universeStudySchema } from '../src/universe-comparison.js';
import type { HybridDecision,HybridFeatures } from '../src/hybrid-research-signals.js';
const json=(p:string)=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const plan=json('examples/hybrid-research.plan.json'),reference=json('examples/pullback-reference.study.json'),baseline=universeStudySchema.parse(reference).parameters;
const decision:HybridDecision={strategy_mode:'TREND_PULLBACK',decisionTimestamp:0,atr:1,pullbackLow:99,sma20:105};
const scenario={name:'test',feeRate:0,slippageRate:0,spreadRate:0,assumedDepthUsdt:1000,maxParticipationRate:.001};
const data=(n=16):HybridInstrument[]=>[{symbol:'BTC/USDT',constraints:{minimumNotionalUsdt:0,minimumQuantity:.0001,quantityStep:.0001},candles1h:[],quoteVolumesUsdt:Array(n).fill(2e6),candles15m:Array.from({length:n},(_,i)=>({timestamp:i*900000,open:100,high:100.2,low:99.8,close:100,volume:20000}))}];
const map=(d=decision)=>new Map([['BTC/USDT',[[d]]]]);
const run=(d=data(),option?:'roi'|'full'|'squeeze',signal=decision)=>replayHybridDecisions(d,map(signal),plan,scenario,baseline,1,undefined,undefined,undefined,option);
it('selects only fully closed 1h regime and ignores an arbitrary future suffix',()=>{
 const hours=Array.from({length:260},(_,i)=>({timestamp:i*3600000,open:100+i,high:102+i,low:99+i,close:101+i,volume:100}));
 const cutoff=250*3600000,first=closedHourRegime(hours,cutoff);expect(first.trend).toBe(true);expect(first.lateral).toBe(false);
 for(let i=250;i<hours.length;i++)hours[i]!.close=1;
 expect(closedHourRegime(hours,cutoff)).toEqual(first);expect(closedHourRegime(hours,249*3600000).trend).toBe(false);
 const flat=hours.map((c,i)=>({...c,open:100,high:101,low:99,close:100,timestamp:i*3600000}));
 expect(closedHourRegime(flat,cutoff)).toMatchObject({trend:false,lateral:true,adx:0,slope:0});
});
it('transitions per mode and symbol state without mutating or resetting occupied signals',()=>{
 const a=decision,b={...a,strategy_mode:'MEAN_REVERSION' as const};
 expect(transitionDecisions([a,b],[a])).toEqual([b]);expect(transitionDecisions([a],[a])).toEqual([]);
 expect(transitionDecisions([a],[])).toEqual([a]);expect(transitionDecisions([],[])).toEqual([]);expect(a).toEqual(decision);
});
it('freezes net ROI boundaries including the full 90-to-180-minute interval',()=>{
 expect([0,15,29.99,30,90,179.99,180].map(evolutionNetRoi)).toEqual([.016,.016,.016,.011,.011,.011,.006]);
 for(const age of [-1,Infinity,NaN])expect(()=>evolutionNetRoi(age)).toThrow();
});
it('changes target at the candle OPEN after 30 minutes, never on an earlier intrabar high',()=>{
 const d=data();d[0]!.candles15m[2]!.high=101.3;d[0]!.candles15m[3]!.high=101.3;
 const r=run(d,'roi');expect(r.closedTradeLedger).toHaveLength(1);expect(r.closedTradeLedger[0]).toMatchObject({reason:'TIME_ROI',exitTimestamp:3*900000,holdingCandles:3});expect(r.closedTradeLedger[0]!.netPnlPercent).toBeCloseTo(1.1,9);
 expect(run(d).closedTradeLedger).toHaveLength(0);
});
it('uses the final ROI stage only after 180 minutes and preserves B time-stop at 90 minutes',()=>{
 const d=data();d[0]!.candles15m[12]!.high=100.7;d[0]!.candles15m[13]!.high=100.7;
 const r=run(d,'roi');expect(r.closedTradeLedger[0]).toMatchObject({reason:'TIME_ROI',exitTimestamp:13*900000});expect(r.closedTradeLedger[0]!.netPnlPercent).toBeCloseTo(.6,9);
 expect(run(data(),'roi',{...decision,strategy_mode:'MEAN_REVERSION'}).closedTradeLedger[0]).toMatchObject({reason:'TIME_STOP',holdingCandles:6});
});
it('retains stop-first precedence and adverse opening gaps under timed ROI',()=>{
 const d=data();d[0]!.candles15m[3]={timestamp:2700000,open:98,low:97,high:103,close:100,volume:20000};
 const r=run(d,'roi');expect(r.closedTradeLedger[0]).toMatchObject({reason:'STOP_LOSS',exitPrice:98});expect(r.closedTradeLedger[0]!.netPnlUsdt).toBeLessThan(0);
});
it('gates potential reward using net cash and both execution legs without assuming expected profitability',()=>{
 const q={cost:10,quantity:.0996,fill:100.1,referencePrice:100,stop:99,target:103,fee:.004,slippage:.001};
 expect(evolutionQuoteGate(q)).toBeNull();expect(evolutionQuoteGate({...q,target:100.5})).toBe('net_reward_risk');expect(evolutionQuoteGate({...q,stop:101})).toBe('net_reward_risk');
 expect(evolutionQuoteGate({...q,quantity:.095,target:107})).not.toBeNull();
 const bad={...decision,sma20:100.1,strategy_mode:'MEAN_REVERSION' as const};expect(run(data(),'full',bad).entries).toHaveLength(0);
});
it('requires previous compression, closed breakout, volume, macro regime and ATR for C',()=>{
 const history=Array.from({length:84},(_,i)=>({timestamp:i*900000,open:100,close:100,high:101,low:99,volume:100}));
 history[83]={timestamp:83*900000,open:100,close:103,high:104,low:100,volume:500};
 const f={previous:history[82]!,current:history[83]!,atr14:1,sma20:100} as HybridFeatures,regime={trend:true,lateral:false,adx:30,slope:.01};
 expect(squeezeDecision(history,f,regime)[0]).toMatchObject({strategy_mode:'VOLATILITY_SQUEEZE',decisionTimestamp:83*900000});
 expect(squeezeDecision(history,f,{...regime,trend:false})).toEqual([]);expect(squeezeDecision(history,{...f,atr14:.1},regime)).toEqual([]);
 history[83]!.volume=100;expect(squeezeDecision(history,f,regime)).toEqual([]);
});
it('keeps C isolated with an identified fixed 3% net target and no operational promotion',()=>{
 const d=data();d[0]!.candles15m[2]!.high=110;
 const signal={...decision,strategy_mode:'VOLATILITY_SQUEEZE' as const};expect(()=>run(d,undefined,signal)).toThrow(/frozen/);
 const r=run(d,'squeeze',signal);expect(r.closedTradeLedger[0]).toMatchObject({strategy_mode:'VOLATILITY_SQUEEZE',reason:'TAKE_PROFIT'});expect(r.closedTradeLedger[0]!.netPnlPercent).toBeCloseTo(3,9);expect(r.byMode.at(-1)!.closedTrades).toBe(1);expect(r.realMoneyApproved).toBe(false);
});
it('requires both costs, sufficient sample, positive blocks, PF>1.25 and profit without top3',()=>{
 const r={name:'A_FULL',scenario:'account-conditioned',closedTrades:30,expectancyUsdt:.01,profitFactor:1.3,netReturnUsdt:.3,maxDrawdownPercent:1,realizedPnlWithoutTop3Usdt:.01,blocks:Array.from({length:3},()=>({complete:true,netReturnUsdt:.1}))};
 const approved=(rows:any[])=>screenEvolution(rows).find(s=>s.name==='A_FULL')!.eligibleForFutureIndependentProtocol;
 expect(approved([r,{...r,scenario:'account-cost-stress'}])).toBe(true);expect(approved([r,r])).toBe(false);
 for(const change of [{closedTrades:29},{profitFactor:1.25},{expectancyUsdt:0},{netReturnUsdt:0},{maxDrawdownPercent:10},{realizedPnlWithoutTop3Usdt:0},{blocks:[]}])expect(approved([r,{...r,...change,scenario:'account-cost-stress'}])).toBe(false);
 expect(screenEvolution([{...r,name:'AB_FULL'},{...r,name:'AB_FULL',scenario:'account-cost-stress'}]).find(s=>s.name==='AB_FULL')!.eligibleForFutureIndependentProtocol).toBe(false);
});
it('rejects another dataset instead of silently consulting holdout or tuning the protocol',()=>{
 expect(()=>runHybridEvolution({asOfUtc:'2026-11-22T23:00:00Z',instruments:[]},plan,reference,json('examples/hybrid-shadow.profile.json'),{runs:[]},json('examples/hybrid-evolution.plan.json'))).toThrow();
 expect(()=>replayHybridDecisions(data(),map(),plan,scenario,baseline,1,undefined,undefined,'A_VOLUME_OFF','roi')).toThrow(/cannot be mixed/);
 expect(()=>runHybridEvolution({},plan,reference,json('examples/hybrid-shadow.profile.json'),{runs:[]},{})).toThrow(/protocol identity/);
});
it('CLI refuses existing output before any replay and preserves its exact bytes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hybrid-evolution-')),marker=join(dir,'summary.json');
 try{
  await writeFile(marker,'original evidence\n');
  expect(()=>execFileSync(process.execPath,['--import','tsx','src/hybrid-evolution-cli.ts','missing-data.json',dir],{cwd:new URL('../',import.meta.url),stdio:'pipe'})).toThrow(/refusing overwrite/);
  expect(await readFile(marker,'utf8')).toBe('original evidence\n');
 }finally{await rm(dir,{recursive:true,force:true});}
});
