import { expect,it } from "vitest";
import { meanReversionEntry } from "../src/mean-reversion-study.js";
import type { Candle } from "../src/types.js";
const series=(closes:number[]):Candle[]=>closes.map((close,i)=>({timestamp:i*900000,open:close,high:close+.1,low:close-.1,close,volume:1000}));
it("requires warmup and rejects flat or invalid data",()=>{
 expect(meanReversionEntry(series(Array(83).fill(100)))).toBe(false);
 expect(meanReversionEntry(series(Array(100).fill(100)))).toBe(false);
 expect(meanReversionEntry(series([...Array(99).fill(100),NaN]))).toBe(false);
});
it("admits an oversold lower-band touch within the fixed bandwidth",()=>{
 const candles=series([...Array.from({length:99},(_,i)=>100+(i%2)*.02),99]);
 expect(meanReversionEntry(candles)).toBe(true);
 expect(meanReversionEntry(candles.slice(0,-1))).toBe(false);
});
it("rejects a wide-band drop rather than interpreting every fall as mean reversion",()=>{
 expect(meanReversionEntry(series([...Array(99).fill(100),80]))).toBe(false);
});
