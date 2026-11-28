import { expect, it } from 'vitest';
import { createConfirmedReversionGate,reversionObservation,reversionTargetEconomics,type ReversionObservation } from '../src/confirmed-mean-reversion.js';
const observation=(i:number,close=98,rsi7=20,lowerBand=99,belowFallingEma50=false):ReversionObservation=>({candle:{timestamp:i*900000,open:close-.1,high:close+.2,low:close-.2,close,volume:1000},sma20:102,lowerBand,deviation:1,rsi7,atr14:1,belowFallingEma50});
const setup=()=>{const g=createConfirmedReversionGate();expect(g(observation(0,100))).toMatchObject({reason:'no_setup'});expect(g(observation(1))).toMatchObject({reason:'setup'});return g;};
it('uses population Bollinger20/2 and RSI7 with only the supplied closed history',()=>{
 const candles=Array.from({length:100},(_,i)=>({timestamp:i*900000,open:100+i%20,high:101+i%20,low:99+i%20,close:100+i%20,volume:1000}));
 const o=reversionObservation(candles);expect(o.sma20).toBe(109.5);expect(o.deviation).toBeCloseTo(Math.sqrt(33.25),12);expect(o.lowerBand).toBeCloseTo(109.5-2*Math.sqrt(33.25),12);
 expect(Number.isFinite(o.rsi7)).toBe(true);expect(()=>reversionObservation(candles.slice(0,50))).toThrow(/84/);
});
it('requires a prior oversold outside close and a later green recovery, never same-bar proximity',()=>{
 const g=setup();const result=g(observation(2,99.5));expect(result).toEqual({reason:'confirmed',setup:{targetPrice:102,decisionTimestamp:1800000}});
 expect(g(observation(3,99.7))).toMatchObject({reason:'no_setup'});
 const h=createConfirmedReversionGate();expect(h(observation(0,99.5))).not.toHaveProperty('setup');
 const red=setup(),o=observation(2,99.5);o.candle.open=100;expect(red(o)).toMatchObject({reason:'waiting'});
});
it('RSI25 is excluded and rejection consumes the recovery instead of waiting for a better future RSI',()=>{
 const g=setup();expect(g(observation(2,99.5,25))).toMatchObject({reason:'recovery_rsi_rejected'});expect(g(observation(3,99.7,20))).not.toHaveProperty('setup');
 expect(setup()(observation(2,99.5,24.999))).toHaveProperty('setup');
});
it('blocks falling EMA50 at recovery and expires without renewing an outside cluster',()=>{
 const g=setup();expect(g(observation(2,99.5,20,99,true))).toMatchObject({reason:'falling_trend_rejected'});
 const e=setup();for(let i=2;i<=5;i++)expect(e(observation(i))).toMatchObject({reason:'waiting'});expect(e(observation(6))).toMatchObject({reason:'expired'});expect(e(observation(7))).toMatchObject({reason:'no_setup'});expect(e(observation(8,99.5))).not.toHaveProperty('setup');
});
it('permits a new attempt only after a fresh outside excursion and resets flat/zero ATR states',()=>{
 const g=setup();expect(g(observation(2,99.5))).toHaveProperty('setup');expect(g(observation(3))).toMatchObject({reason:'setup'});expect(g(observation(4,99.5))).toHaveProperty('setup');
 const f=setup();expect(f({...observation(2),atr14:0})).toMatchObject({reason:'flat'});expect(f(observation(3,99.5))).not.toHaveProperty('setup');
});
it('has causal clocked state and freezes the known target instead of changing a saved setup',()=>{
 const g=setup(),o=observation(2,99.5),result=g(o);o.sma20=120;expect(result.setup!.targetPrice).toBe(102);
 expect(()=>g(observation(2,100))).toThrow(/Consecutive/);
});
it('covers both fee currencies and both execution legs; rejects a gap that consumes the target margin',()=>{
 for(const entryFeeCurrency of ['base','quote'] as const){
  const c={feeRate:.004,slippageRate:.001,spreadRate:.0015,entryFeeCurrency};
  const standard=reversionTargetEconomics(100,102,c);expect(standard.allowed).toBe(true);
  expect(reversionTargetEconomics(102,102,c).allowed).toBe(false);
  const effective=(1+c.slippageRate)*(1+c.spreadRate/2)-1;
  const cost=100*(1+effective)*(entryFeeCurrency==='quote'?1.004:1),quantity=entryFeeCurrency==='base'?.996:1;
  expect(standard.netReturnRate).toBeCloseTo(102*(1-effective)*quantity*.996/cost-1,12);
 }
 expect(reversionTargetEconomics(100,100,{feeRate:0,slippageRate:0,spreadRate:0,entryFeeCurrency:'base'}).allowed).toBe(false);
});
it('detects a falling EMA50 from its closed four-bar slope, rather than using future trend',()=>{
 const candles=Array.from({length:100},(_,i)=>({timestamp:i*900000,open:200-i,high:201-i,low:199-i,close:200-i,volume:1000}));
 expect(reversionObservation(candles).belowFallingEma50).toBe(true);
 const prefix=reversionObservation(candles.slice(0,90));candles[99]!.close=10000;expect(reversionObservation(candles.slice(0,90))).toEqual(prefix);
});
