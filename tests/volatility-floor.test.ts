import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { compareUniverseSizes, universeStudySchema, type UniverseDataset } from '../src/universe-comparison.js';
vi.mock('../src/strategy.js',()=>({evaluateStrategy:()=>({action:'BUY',score:8,rsi14:55})}));
vi.mock('../src/signal-ranking.js',()=>({assessMarketQuality:()=>({score:3})}));
it('applies the floor to completed decision candles, never to the entry bar or future volatility',()=>{
 const ref=JSON.parse(readFileSync(new URL('../examples/pullback-reference.study.json',import.meta.url),'utf8'));
 const study=universeStudySchema.parse({...ref,sizes:[1,2],fixedSymbols:[],minDailyQuoteVolumeUsdt:0});
 const length=study.warmupCandles+2880,end=Date.parse(study.endExclusiveUtc),spike=study.warmupCandles+1000;
 const data:UniverseDataset[]=['BTC/USDT','ETH/USDT'].map(symbol=>({symbol,constraints:{minimumNotionalUsdt:0,minimumQuantity:.001,quantityStep:.001},quoteVolumesUsdt:Array(length).fill(2e6),candles:Array.from({length},(_,i)=>({timestamp:end-(length-i)*900000,open:100,high:i===spike?112:100.2,low:99.8,close:100,volume:20000}))}));
 const baseline=compareUniverseSizes(data,study),filtered=compareUniverseSizes(data,study,'trend',undefined,undefined,{minimumAtrRate:.0075});
 expect(baseline.results[0]!.scenarios[0]!.result.closedTradeLedger.length).toBeGreaterThan(0);
 // The only post-floor position stays open: its first entry must be strictly after the spike.
 const open=filtered.results[0]!.scenarios[0]!.result.perSymbol.flatMap(r=>r.openPosition?[r.openPosition]:[]);
 expect(open.length).toBeGreaterThan(0);expect(open.every(p=>p.entryTimestamp===data[0]!.candles[spike+1]!.timestamp)).toBe(true);
 expect(filtered.results[0]!.scenarios[0]!.result.closedTrades).toBe(0);
 const more=structuredClone(data);more[0]!.candles[spike+500]!.high=120;
 expect(compareUniverseSizes(more,study,'trend',undefined,undefined,{minimumAtrRate:.0075}).calibration).toEqual(filtered.calibration);
});
