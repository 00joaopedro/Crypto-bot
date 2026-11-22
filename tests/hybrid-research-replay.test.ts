import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { replayHybridDecisions,type HybridInstrument } from '../src/hybrid-research-replay.js';
import { universeStudySchema } from '../src/universe-comparison.js';
import type { HybridDecision,ResearchMode } from '../src/hybrid-research-signals.js';
const plan=JSON.parse(readFileSync(new URL('../examples/hybrid-research.plan.json',import.meta.url),'utf8'));
const baseline=universeStudySchema.parse(JSON.parse(readFileSync(new URL('../examples/pullback-reference.study.json',import.meta.url),'utf8'))).parameters;
const costs={feeRate:.001,slippageRate:.0005,spreadRate:.0015,entryFeeCurrency:'base' as const};
const scenario={name:'hypothesis',feeRate:.001,slippageRate:.0005,spreadRate:.0015,assumedDepthUsdt:1000,maxParticipationRate:.001,symbolCosts:{'BTC/USDT':costs,'ETH/USDT':costs}};
const decision=(mode:ResearchMode,t=0):HybridDecision=>({strategy_mode:mode,decisionTimestamp:t,atr:1,pullbackLow:99,sma20:105});
function data(n=10):HybridInstrument[]{return ['BTC/USDT','ETH/USDT'].map(symbol=>({symbol,constraints:{minimumNotionalUsdt:0,minimumQuantity:.0001,quantityStep:.0001},candles1h:[],quoteVolumesUsdt:Array(n).fill(2e6),candles15m:Array.from({length:n},(_,i)=>({timestamp:i*900000,open:100,high:100.2,low:99.8,close:100,volume:20000}))}));}
const run=(d:HybridInstrument[],map:Map<string,HybridDecision[][]>,s=scenario)=>replayHybridDecisions(d,map,plan,s,baseline,1);
it('uses one shared 17-USDT wallet, deterministic pair/mode priority and no same-bar proceeds reuse',()=>{
 const d=data();d[0]!.candles15m[1]!.high=110;
 const map=new Map([['BTC/USDT',[[decision('MEAN_REVERSION'),decision('TREND_PULLBACK')]]],['ETH/USDT',[[decision('MEAN_REVERSION')]]]]);
 const r=run(d,map);expect(r.entries).toHaveLength(1);expect(r.entries[0]).toMatchObject({symbol:'BTC/USDT',strategy_mode:'TREND_PULLBACK',entryTimestamp:900000});expect(r.peakConcurrentPositions).toBe(1);expect(r.entries[0]!.notionalUsdt).toBeLessThanOrEqual(10);expect(r.finalEquityUsdt).toBeCloseTo(17+r.realizedPnlUsdt,10);expect(r.peakExposureRate).toBeGreaterThan(.58);
});
it('time-stops B at the sixth completed held candle (90 minutes) without changing the frozen target',()=>{
 const r=run(data(),new Map([['BTC/USDT',[[decision('MEAN_REVERSION')]]]]));
 expect(r.closedTradeLedger[0]).toMatchObject({reason:'TIME_STOP',strategy_mode:'MEAN_REVERSION',holdingCandles:6,entryTimestamp:900000,exitTimeProxy:7*900000});expect(r.closedTrades).toBe(1);expect(r.feesUsdt).toBeGreaterThan(0);
});
it('uses stop before target on an ambiguous candle, and target before time-stop when only target touches',()=>{
 const d=data();d[0]!.candles15m[6]!.high=110;
 expect(run(d,new Map([['BTC/USDT',[[decision('MEAN_REVERSION')]]]])).closedTradeLedger[0]!.reason).toBe('TAKE_PROFIT');
 d[0]!.candles15m[6]!.low=95;expect(run(d,new Map([['BTC/USDT',[[decision('MEAN_REVERSION')]]]])).closedTradeLedger[0]!.reason).toBe('STOP_LOSS');
});
it('activates A after close, applies a valid net floor only to later candles and models a gap below it',()=>{
 const d=data(5);d[0]!.candles15m[2]={timestamp:1800000,open:100,high:102.3,low:99.5,close:102,volume:20000};d[0]!.candles15m[3]={timestamp:2700000,open:99,high:100,low:98,close:99,volume:20000};
 const r=run(d,new Map([['BTC/USDT',[[decision('TREND_PULLBACK')]]]]));
 expect(r.closedTradeLedger[0]).toMatchObject({reason:'TRAILING_STOP',exitTimestamp:2700000});expect(r.closedTradeLedger[0]!.netPnlUsdt).toBeLessThan(0);expect(r.entries[0]!.estimatedInitialLossUsdt).toBeGreaterThan(.11);
});
it('caps A at a true modeled 2.8% net return including base entry fee and both execution legs',()=>{
 const d=data(4);d[0]!.candles15m[2]!.high=110;
 const r=run(d,new Map([['BTC/USDT',[[decision('TREND_PULLBACK')]]]]));expect(r.closedTradeLedger[0]!.reason).toBe('TAKE_PROFIT');expect(r.closedTradeLedger[0]!.netPnlPercent).toBeCloseTo(2.8,9);
});
it('rejects an uneconomic SMA target or an invalid gap stop instead of moving the levels',()=>{
 const b={...decision('MEAN_REVERSION'),sma20:100.3};expect(run(data(),new Map([['BTC/USDT',[[b]]]])).rejected.target_costs).toBe(1);
 const a={...decision('TREND_PULLBACK'),pullbackLow:110};expect(run(data(),new Map([['BTC/USDT',[[a]]]])).rejected.exit_levels).toBe(1);
});
it('preserves open positions and marks, refuses invalid clocks/unknown pairs and does not promote partial blocks',()=>{
 const r=run(data(3),new Map([['BTC/USDT',[[decision('MEAN_REVERSION')]]]]));expect(r.openPosition?.strategy_mode).toBe('MEAN_REVERSION');expect(r.closedTrades).toBe(0);expect(r.profitFactor).toBeNull();expect(r.blocks.every(b=>!b.complete)).toBe(true);expect(r.configurationPromoted).toBe(false);
 expect(()=>run(data(),new Map([['BTC/USDT',[[decision('MEAN_REVERSION',1)]]]]))).toThrow(/frozen/);
 const bad=data();bad[0]!.symbol='USDC/USDT';expect(()=>run(bad,new Map())).toThrow(/watchlist/);
});
it('does not depend on a future suffix for earlier entries/exits',()=>{
 const d=data(),map=new Map([['BTC/USDT',[[decision('MEAN_REVERSION')]]]]),before=run(d,map);d[0]!.candles15m[9]!.high=150;
 expect(run(d,map).closedTradeLedger).toEqual(before.closedTradeLedger);
});

it('does not arm trailing on a transient high without a net-profitable confirming close',()=>{
 const d=data(3);d[0]!.candles15m[2]={timestamp:1800000,open:100,high:102,low:99.5,close:100.5,volume:20000};
 const r=run(d,new Map([['BTC/USDT',[[decision('TREND_PULLBACK')]]]]));expect(r.openPosition!.stopPrice).toBe(r.entries[0]!.stopPrice);
});
