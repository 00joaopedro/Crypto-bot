import { describe, expect, it } from "vitest";
import { exitPolicySchema, initialExitRates, advanceExitStop } from "../src/exit-policy.js";
import { PaperTrader } from "../src/paper-trader.js";
import type { Candle } from "../src/types.js";
const candles = (close = 110, high = 111): Candle[] => Array.from({length:20},(_,i)=>({timestamp:i*900000,open:close,high,low:close-1,close,volume:1000}));
const fixed = exitPolicySchema.parse({mode:"fixed"});
const trailing = exitPolicySchema.parse({mode:"trailing_atr",activationRate:.02,trailingMultiplier:2});
const base = {initialBalanceUsdt:1000,tradeSizeUsdt:100,feeRate:.001,slippageRate:0,stopLossRate:.05,takeProfitRate:.02};
describe("shared managed exit policy",()=>{
  it("uses identical ATR initial levels, bounded stops and explicit fixed fallback",()=>{
    const rates=initialExitRates(candles(),110,fixed,{stopLossRate:.01,takeProfitRate:.02});
    expect(rates.stopLossRate).toBeCloseTo(3/110);
    expect(initialExitRates([],100,fixed,{stopLossRate:.01,takeProfitRate:.02})).toEqual({stopLossRate:.01,takeProfitRate:.02});
  });
  it("ratchets after close without loosening or inventing a crossed stop",()=>{
    const input={stop:95,highWatermark:100,entryPrice:100,quantity:1,costUsdt:100.1,policy:trailing};
    const first=advanceExitStop({...input,candles:candles()});
    expect(first).toEqual({stop:107,highWatermark:111});
    expect(advanceExitStop({...input,stop:107,highWatermark:111,candles:candles(108,109)}).stop).toBe(107);
    expect(advanceExitStop({...input,stop:107,highWatermark:120,candles:candles(108,109)}).stop).toBe(107);
  });
  it("covers entry cost/base fee loss plus assumed exit fee and slippage at breakeven",()=>{
    const policy=exitPolicySchema.parse({breakeven:true,exitFeeRate:.002,exitSlippageRate:.003});
    const next=advanceExitStop({stop:95,highWatermark:100,entryPrice:100,quantity:.999,costUsdt:100.1,candles:candles(110,111),policy});
    expect(.999*next.stop*(1-.002)*(1-.003)).toBeCloseTo(100.1);
  });
  it("ignores pre-entry highs for close fills, persists policy and uses only previously committed stops",()=>{
    const t=new PaperTrader({...base,exitPolicy:trailing});
    const entry={timestamp:0,open:100,high:150,low:90,close:100,volume:100};
    t.processCandle(entry,true);
    t.advanceManagedExit([entry]);
    expect(t.exportState().position!.highWatermark).toBe(100);
    const history=candles(110,111); history[0]=entry;
    const current=history.at(-1)!;
    expect(t.processCandle(current,false).events).toHaveLength(0); // trailing ignores fixed TP
    t.advanceManagedExit(history);
    const saved=t.exportState();
    expect(saved.position!.stopLossPrice).toBe(107);
    const restored=new PaperTrader(base,saved);
    const exit={timestamp:current.timestamp+900000,open:106,high:108,low:105,close:107,volume:100};
    expect(restored.processCandle(exit,false,undefined,true).events[0]).toMatchObject({type:"CLOSED",reason:"STOP_LOSS",exitPrice:106});
  });
  it("fixed mode keeps target and managed mode suppresses contrary-signal exits",()=>{
    const t=new PaperTrader({...base,exitPolicy:fixed});
    t.processCandle({timestamp:0,open:100,high:101,low:99,close:100,volume:10},true);
    expect(t.processCandle({timestamp:1,open:100,high:101,low:99,close:100,volume:10},false,undefined,true).events).toEqual([]);
    expect(t.processCandle({timestamp:2,open:100,high:103,low:99,close:102,volume:10},false).events[0]).toMatchObject({reason:"TAKE_PROFIT"});
  });
});
