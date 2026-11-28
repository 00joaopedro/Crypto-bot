import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { channelChecks, scanChannelContinuation, screenChannelRuns } from '../src/channel-continuation.js';
import { channelQuoteGate } from '../src/hybrid-evolution-options.js';
import { replayHybridDecisions } from '../src/hybrid-research-replay.js';
import { shadowConfiguration } from '../src/hybrid-shadow-session.js';
const json=(p:string)=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const config=shadowConfiguration(json('examples/hybrid-shadow.profile.json'),json('examples/hybrid-research.plan.json'),json('examples/pullback-reference.study.json'));
const bars=(n:number,step=3600000)=>Array.from({length:n},(_,i)=>({timestamp:i*step,open:100+i*.1,high:100.2+i*.1,low:99.9+i*.1,close:100.15+i*.1,volume:100}));
it('requires250closed4h bars and excludes current high from the prior20-bar channel',()=>{
 const q=bars(250,14400000);expect(channelChecks(q.slice(0,249))).toBeNull();
 q[249]!.high=200;q[249]!.close=150;
 const f=channelChecks(q)!;expect(f.upper).toBeCloseTo(q[248]!.high);expect(f.checks).toMatchObject({trend:true,breakout:true,green:true,atr_valid:true});
 q[249]!.close=f.upper;expect(channelChecks(q)!.checks.breakout).toBe(false);
});
it('gates raw continuation by trend and green confirmation',()=>{
 const q=bars(250,14400000);q[249]!.open=200;q[249]!.high=201;q[249]!.close=150;
 expect(channelChecks(q)!.checks.green).toBe(false);
 const down=bars(250,14400000).map((c,i)=>({...c,open:200-i*.1,close:200-i*.1,high:200.2-i*.1,low:199.9-i*.1}));expect(channelChecks(down)!.checks.trend).toBe(false);
});
it('uses4h cadence/false->true without future bars and does not repeat an uninterrupted raw signal',()=>{
 const h=bars(1016);h[999]!.close=h[996]!.open; // final warmup4h is not green
 const a=scanChannelContinuation(h);
 expect(a.rows[1003]).toHaveLength(1);expect(a.rows[1007]).toHaveLength(0);
 expect(a.rows.every((r,i)=>r.length===0||(i+1)%4===0)).toBe(true);
 for(let i=1004;i<h.length;i++){h[i]!.open=1;h[i]!.close=1;h[i]!.high=2;h[i]!.low=.5;}
 expect(scanChannelContinuation(h).rows.slice(0,1004)).toEqual(a.rows.slice(0,1004));
});
it('requires net payoff>=1.5 and gain>=twice modeled roundtrip friction',()=>{
 const q={cost:1,quantity:.00996,fill:100.1,referencePrice:100,stop:96,target:112,fee:.004,slippage:.001};
 expect(channelQuoteGate(q)).toBe(true);expect(channelQuoteGate({...q,target:101})).toBe(false);expect(channelQuoteGate({...q,stop:50})).toBe(false);expect(channelQuoteGate({...q,stop:110})).toBe(false);
});
function replayFixture(){
 const h=bars(5).map(c=>({...c,open:100,high:100.1,low:99.9,close:100}));
 const d=[{symbol:'BTC/USDT',candles15m:h,candles1h:[],constraints:{minimumNotionalUsdt:0,minimumQuantity:.0001,quantityStep:.0001}}];
 const map=new Map([['BTC/USDT',[[{strategy_mode:'CHANNEL_BREAKOUT' as const,decisionTimestamp:0,atr:2,pullbackLow:99,sma20:100}]]]]);
 const scenario={name:'zero',feeRate:0,slippageRate:0,spreadRate:0,assumedDepthUsdt:1000,maxParticipationRate:.001};
 return {h,d,map,scenario};
}
it('freezes4h ATR levels, preserves risk sizing and uses pessimistic stop-first on an ambiguous1h candle',()=>{
 const {h,d,map,scenario}=replayFixture();h[1]!.high=120;h[1]!.low=90;
 const r=replayHybridDecisions(d,map,config.strategy,scenario,config.reference.parameters,1,config.profile.riskLimits,undefined,undefined,'channel',3600000);
 expect(r.entries[0]!.stopPrice).toBeCloseTo(96);expect(r.entries[0]!.targetPrice).toBeCloseTo(112);expect(r.closedTradeLedger[0]).toMatchObject({reason:'STOP_LOSS',exitPrice:96,holdingCandles:1});
 expect(r.entries[0]!.estimatedInitialLossUsdt).toBeLessThanOrEqual(.17);expect(r.byMode.find(x=>x.strategy_mode==='CHANNEL_BREAKOUT')?.closedTrades).toBe(1);expect(r.realMoneyApproved).toBe(false);
});
it('applies stop gap protection and disallows channel decisions in the legacy replay mode',()=>{
 const {h,d,map,scenario}=replayFixture();h[2]={...h[2]!,open:90,low:89,high:120};
 const r=replayHybridDecisions(d,map,config.strategy,scenario,config.reference.parameters,1,config.profile.riskLimits,undefined,undefined,'channel',3600000);
 expect(r.closedTradeLedger[0]!.exitPrice).toBe(90);
 expect(()=>replayHybridDecisions(d,map,config.strategy,scenario,config.reference.parameters,1,config.profile.riskLimits,undefined,undefined,'horizon',3600000)).toThrow(/Invalid frozen/);
 expect(()=>replayHybridDecisions(d,map,config.strategy,scenario,config.reference.parameters,1,config.profile.riskLimits,undefined,undefined,'channel',900000)).toThrow(/Explicit horizon/);
});
it('rejects a stale signal timestamp and a gap in the4h aggregation clock',()=>{
 const f=replayFixture();f.map.get('BTC/USDT')![0]![0]!.decisionTimestamp=3600000;
 expect(()=>replayHybridDecisions(f.d,f.map,config.strategy,f.scenario,config.reference.parameters,1,config.profile.riskLimits,undefined,undefined,'channel',3600000)).toThrow(/Invalid frozen/);
 const h=bars(1008);h[1000]!.timestamp++;expect(()=>scanChannelContinuation(h)).toThrow(/UTC4h/);
});
it('does not let a small profitable sample or duplicate scenario satisfy the predeclared screen',()=>{
 const base={name:'CHANNEL_4H',scenario:'account-conditioned',closedTrades:2,profitFactor:2,expectancyUsdt:1,netReturnUsdt:1,blocks:[{complete:true,netReturnUsdt:1},{complete:true,netReturnUsdt:1},{complete:true,netReturnUsdt:1}],maxDrawdownPercent:1,realizedPnlWithoutTop3Usdt:1};
 expect(screenChannelRuns([base,{...base,scenario:'account-cost-stress'}] as any).eligible).toBe(false);
 expect(screenChannelRuns([{...base,closedTrades:30},{...base,closedTrades:30}] as any).eligible).toBe(false);
 expect(screenChannelRuns([{...base,closedTrades:30},{...base,closedTrades:30,scenario:'account-cost-stress'}] as any).eligible).toBe(true);
 expect(screenChannelRuns([{...base,closedTrades:30},{...base,closedTrades:30,scenario:'account-cost-stress',realizedPnlWithoutTop3Usdt:0}] as any).eligible).toBe(false);
 expect(screenChannelRuns([{...base,closedTrades:30},{...base,closedTrades:30,scenario:'unexpected'}] as any).eligible).toBe(false);
});
it('keeps one shared position and fixed core priority even when the first trade closes in the entry candle',()=>{
 const f=replayFixture();f.h[1]!.high=120;f.h[1]!.low=90;
 const eth={...f.d[0]!,symbol:'ETH/USDT'};f.map.set('ETH/USDT',f.map.get('BTC/USDT')!);
 const events:any[]=[];const r=replayHybridDecisions([eth,...f.d],f.map,config.strategy,f.scenario,config.reference.parameters,1,config.profile.riskLimits,e=>events.push(e),undefined,'channel',3600000);
 expect(r.entries).toHaveLength(1);expect(r.entries[0]!.symbol).toBe('BTC/USDT');expect(r.peakConcurrentPositions).toBe(1);
 expect(events).toContainEqual(expect.objectContaining({symbol:'ETH/USDT',reason:'portfolio_priority',outcome:'rejected'}));
});
