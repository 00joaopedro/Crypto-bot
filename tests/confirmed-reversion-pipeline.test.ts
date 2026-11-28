import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { compareUniverseSizes,universeStudySchema,type UniverseDataset } from '../src/universe-comparison.js';
it('admits a valid cost-covered synthetic rejection through the full indicator/membership/portfolio pipeline',()=>{
 const ref=JSON.parse(readFileSync(new URL('../examples/pullback-reference.study.json',import.meta.url),'utf8'));
 const study=universeStudySchema.parse({...ref,warmupCandles:100,sizes:[1,2],fixedSymbols:[],minDailyQuoteVolumeUsdt:0});
 const length=study.warmupCandles+2880,end=Date.parse(study.endExclusiveUtc),confirmation=1200,upStart=1100;
 const datasets:UniverseDataset[]=['BTC/USDT','ETH/USDT'].map(symbol=>({symbol,constraints:{minimumNotionalUsdt:0,minimumQuantity:.001,quantityStep:.001},quoteVolumesUsdt:Array(length).fill(2e6),candles:Array.from({length},(_,i)=>{
 let p=100;
 if(symbol==='BTC/USDT'&&i>=upStart){const t=i-upStart;p=t<98?100+.1*t:t<=101?106.7+.1*(t-98):109;}
 return {timestamp:end-(length-i)*900000,open:p-.02,high:p+.2,low:p-.2,close:p,volume:20000};
 })}));
 const report=compareUniverseSizes(datasets,study,'confirmed_mean_reversion');
 const result=report.results[0]!.scenarios[0]!.result;
 expect(report.confirmedReversionDiagnostics!.eligible_before_membership).toBeGreaterThan(0);
 expect(result.closedTrades).toBe(1);expect(result.closedTradeLedger[0]!).toMatchObject({symbol:'BTC/USDT',reason:'TAKE_PROFIT',entryTimestamp:datasets[0]!.candles[confirmation+1]!.timestamp});
 expect(result.realizedPnlUsdt).toBeGreaterThan(0);
 const changed=structuredClone(datasets);changed[0]!.candles[2000]!.high=150;
 expect(compareUniverseSizes(changed,study,'confirmed_mean_reversion').calibration).toEqual(report.calibration);
});
