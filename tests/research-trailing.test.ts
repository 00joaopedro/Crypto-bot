import { describe, expect, it } from "vitest";
import { advanceResearchTrailing, netActivationPrice, type ResearchTrailing } from "../src/research-trailing.js";
import { exitPolicySchema } from "../src/exit-policy.js";
import { PaperTrader } from "../src/paper-trader.js";
import type { Candle } from "../src/types.js";
const research:ResearchTrailing={netActivationRate:.012,trailingMultiplier:1.5,retainFixedTarget:false};
const bars=(close:number,high=close+.2):Candle[]=>Array.from({length:20},(_,i)=>({timestamp:i*900000,open:close,high,low:close-.2,close,volume:1000}));
const base={stop:98,highWatermark:100,costUsdt:100,quantity:.996,activated:false,atrPeriod:14,feeRate:.004,slippageRate:.00175,research};
const candle=(i:number,open:number,high:number,low:number,close:number):Candle=>({timestamp:i*900000,open,high,low,close,volume:1000});
const policy=exitPolicySchema.parse({mode:'trailing_atr',breakeven:false});
const options={initialBalanceUsdt:1000,tradeSizeUsdt:100,feeRate:.004,entryFeeCurrency:'base' as const,slippageRate:0,stopLossRate:.05,takeProfitRate:.01,exitPolicy:policy,researchTrailing:research};
describe('offline net-profit trailing',()=>{
 it('includes base entry fees, exit fee and liquidation spread/slippage exactly once',()=>{
  const price=netActivationPrice(100,.996,.004,.00175,.012);
  expect(price*.996*(1-.004)*(1-.00175)/100-1).toBeCloseTo(.012,12);
  expect(price).toBeGreaterThan(101.2);
  const quote=netActivationPrice(100.4,1,.004,.00175,.012);
  expect(quote*(1-.004)*(1-.00175)/100.4-1).toBeCloseTo(.012,12);
  expect(()=>netActivationPrice(100,0,.004,.00175,.012)).toThrow();
 });
 it('requires a surviving closed-candle net return, not a raw 1.2% move or transient high',()=>{
  expect(advanceResearchTrailing({...base,candles:bars(101.2,104)})).toMatchObject({activated:false,stop:98});
  expect(advanceResearchTrailing({...base,candles:bars(103)}).activated).toBe(true);
 });
 it('latches activation, never loosens, and does not invent an already crossed level',()=>{
  const first=advanceResearchTrailing({...base,candles:bars(103)});
  expect(first.stop).toBeGreaterThan(98);
  const later=advanceResearchTrailing({...base,...first,candles:bars(102.9,103)});
  expect(later.activated).toBe(true);expect(later.stop).toBeGreaterThanOrEqual(first.stop);
  expect(advanceResearchTrailing({...base,highWatermark:120,activated:true,candles:bars(103)}).stop).toBe(98);
 });
 it('keeps the initial stop, optionally keeps target and can close before activation',()=>{
  const kept=new PaperTrader({...options,researchTrailing:{...research,retainFixedTarget:true}});
  kept.processCandle(candle(0,100,100,100,100),true,undefined,false,100);
  const p=kept.exportState().position!;expect(p.stopLossPrice).toBe(95);
  expect(kept.processCandle(candle(1,100,101.1,99,101),false).events[0]).toMatchObject({reason:'TAKE_PROFIT'});
  const removed=new PaperTrader(options);removed.processCandle(candle(0,100,100,100,100),true,undefined,false,100);
  expect(removed.processCandle(candle(1,100,101.1,99,101),false).events).toEqual([]);
  removed.advanceManagedExit([candle(0,100,100,100,100),candle(1,100,101.1,99,101)]);
  expect(removed.exportState().position).toMatchObject({stopLossPrice:95,researchTrailingActivated:false});
  expect(removed.processCandle(candle(2,94,95,93,94),false).events[0]).toMatchObject({reason:'STOP_LOSS',exitPrice:94});
 });
 it('uses only previously committed stops and preserves activation across restore',()=>{
  const t=new PaperTrader(options);t.processCandle(candle(0,100,100,100,100),true,undefined,false,100);
  const history=bars(103);history[0]=candle(0,100,100,100,100);
  // A low below the proposed new stop, but above the initial stop, cannot trigger a retrospective exit.
  history[19]=candle(19,103,103.2,99,103);
  expect(t.processCandle(history[19]!,false).events).toEqual([]);t.advanceManagedExit(history);
  const state=t.exportState();expect(state.position!.researchTrailingActivated).toBe(true);expect(state.position!.stopLossPrice).toBeGreaterThan(99);
  const {researchTrailing: _offlineOption,...runtimeOptions}=options;
  const restored=new PaperTrader(runtimeOptions,state);
  const stop=state.position!.stopLossPrice;
  expect(restored.processCandle(candle(20,stop-.1,stop+.1,stop-.2,stop),false).events[0]).toMatchObject({reason:'STOP_LOSS',exitPrice:stop-.1});
  const invalid=structuredClone(state);(invalid.position as any).researchTrailingActivated='yes';expect(()=>new PaperTrader(options,invalid)).toThrow(/restored/);
 });
 it('still takes the conservative stop when stop and fixed target touch together',()=>{
  const t=new PaperTrader({...options,researchTrailing:{...research,retainFixedTarget:true}});t.processCandle(candle(0,100,100,100,100),true,undefined,false,100);
  expect(t.processCandle(candle(1,100,105,90,102),false).events[0]).toMatchObject({reason:'STOP_LOSS'});
 });
 it('rejects incompatible research options instead of silently changing fixed policies',()=>{
  expect(()=>new PaperTrader({...options,exitPolicy:exitPolicySchema.parse({mode:'fixed'})})).toThrow(/requires/);
 });
});
