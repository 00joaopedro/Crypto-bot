import { expect, it } from "vitest";
import { createPullbackGate, type PullbackObservation, type PullbackRule } from "../src/research-pullback.js";
const observation = (i: number, close: number, high = close + .05, low = close - .05, rsi = 55, bullish = true): PullbackObservation => ({candle:{ timestamp:i*900000,open:close-.1,close,high,low,volume:1000 },ema21:100,atr:1,rsi,bullish});
const setup = (rule: PullbackRule = "confirmed-pullback") => {
  const gate=createPullbackGate(rule);
  expect(gate(observation(0,101))).toBe(false);
  expect(gate(observation(1,100.2,100.3,100))).toBe(false);
  return gate;
};
it('requires a prior extension and pullback, never same-bar confirmation or mere proximity',()=>{
  const gate=createPullbackGate('confirmed-pullback');
  expect(gate(observation(0,100.2))).toBe(false);expect(gate(observation(1,100.5))).toBe(false);
  expect(setup()(observation(2,100.5))).toBe(true);
});
it('emits one attempt per recuo and only rearms after a fresh extension',()=>{
  const g=setup();expect(g(observation(2,100.5))).toBe(true);expect(g(observation(3,100.6))).toBe(false);
  expect(g(observation(4,100.1))).toBe(false);expect(g(observation(5,100.6))).toBe(false);
  expect(g(observation(6,101))).toBe(false);expect(g(observation(7,100.2,100.3,100))).toBe(false);expect(g(observation(8,100.5))).toBe(true);
});
it('RSI58 consumes the same recovery attempt even when it rejects the trade',()=>{
  const g=setup('confirmed-pullback-rsi58');expect(g(observation(2,100.5,100.55,100.45,58.01))).toBe(false);
  expect(g(observation(3,100.6,100.65,100.55,55))).toBe(false);
  expect(setup('confirmed-pullback-rsi58')(observation(2,100.5,100.55,100.45,58))).toBe(true);
});
it('invalidates on broken setup low, trend loss and expiry, without refreshing',()=>{
  const g=setup();expect(g(observation(2,100.5,100.6,99.9))).toBe(false);expect(g(observation(3,100.7))).toBe(false);
  const t=setup();expect(t(observation(2,100.5,100.6,100.4,55,false))).toBe(false);expect(t(observation(3,100.7))).toBe(false);
  const e=setup();for(let i=2;i<=5;i++)expect(e(observation(i,100.2,100.3,100.1))).toBe(false);expect(e(observation(6,100.5))).toBe(false);
});
it('requires close above previous high and EMA21, a green candle and bounded extension',()=>{
  expect(setup()(observation(2,100.3))).toBe(false);
  const o=observation(2,100.5);o.candle.open=100.6;expect(setup()(o)).toBe(false);
  expect(setup()(observation(2,100.81))).toBe(false);
  const g=createPullbackGate('near-ema21');expect(g(observation(0,100.8))).toBe(true);expect(g(observation(1,99.9))).toBe(false);expect(g(observation(2,100.81))).toBe(false);
});
it('is causal under suffix changes and rejects duplicate or skipped clocks',()=>{
  const bars=[observation(0,101),observation(1,100.2,100.3,100),observation(2,100.5),observation(3,101)];
  const g=createPullbackGate('confirmed-pullback'),first=bars.map(g);
  bars[3]=observation(3,200);const h=createPullbackGate('confirmed-pullback');expect(bars.map(h).slice(0,3)).toEqual(first.slice(0,3));
  expect(()=>h(bars[3]!)).toThrow(/consecutive/);
});
it('treats zero ATR as unavailable setup and resets pending state without fabricating distance',()=>{
 const g=setup();expect(g({...observation(2,100.5),atr:0})).toBe(false);expect(g(observation(3,100.7))).toBe(false);
});
