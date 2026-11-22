import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { runPortfolioScenario } from '../src/portfolio-comparison.js';
import { universeStudySchema } from '../src/universe-comparison.js';
const study=universeStudySchema.parse(JSON.parse(readFileSync(new URL('../examples/pullback-reference.study.json',import.meta.url),'utf8')));
function replay(target=102,entryOpen=100,scenario=study.scenarios[0]!,simultaneous=false){
 const instruments=['BTC/USDT','ETH/USDT'].map(symbol=>({symbol,constraints:{minimumNotionalUsdt:0,minimumQuantity:.001,quantityStep:.001},quoteVolumesUsdt:Array(7).fill(2e6),candles:Array.from({length:7},(_,i)=>({timestamp:i*900000,open:i===2?entryOpen:100,high:i===3?103:i===2?Math.max(100.1,entryOpen):100.1,low:i===3?(simultaneous?98:100):99.9,close:i===3?101:100,volume:20000}))}));
 const scores=new Map([['BTC/USDT',[undefined,8,undefined,undefined,undefined,undefined,undefined]]]);
 const plans=new Map([['BTC/USDT',[undefined,{targetPrice:target,decisionTimestamp:900000}]]]);
 const result=runPortfolioScenario(instruments,scores,1,study.parameters,scenario,{maxConcurrentPositions:1,maxExposureRate:1,maxAltExposureRate:1},100,10,undefined,4,100,undefined,plans);
 return {result,instruments,scores,plans};
}
it('fixes the SMA target as an absolute price known at decision and retains the ATR initial stop',()=>{
 const {result}=replay();expect(result.closedTrades).toBe(1);expect(result.closedTradeLedger[0]!.reason).toBe('TAKE_PROFIT');
 const costs=study.scenarios[0]!.symbolCosts!['BTC/USDT']!,effective=(1+costs.slippageRate)*(1+costs.spreadRate/2)-1;
 expect(result.closedTradeLedger[0]!.exitPrice).toBeCloseTo(102*(1-effective),12);
 expect(result.closedTradeLedger[0]!.entryTimestamp).toBe(1800000);
});
it('rechecks target economics at entry and under adverse costs without moving the target',()=>{
 const gap=replay(102,102).result;expect(gap.closedTrades).toBe(0);expect(gap.openPositions).toBe(0);expect(gap.perSymbol[0]!.rejected.targetCosts).toBe(1);
 expect(replay(101.5).result.closedTrades).toBe(1);
 const stress=replay(101.5,100,study.scenarios[1]!).result;expect(stress.closedTrades).toBe(0);expect(stress.perSymbol[0]!.rejected.targetCosts).toBe(1);
});
it('uses the protective stop when both levels touch and refuses missing frozen targets',()=>{
 const {result,instruments,scores,plans}=replay(102,100,study.scenarios[0]!,true);expect(result.closedTradeLedger[0]!.reason).toBe('STOP_LOSS');
 plans.clear();expect(()=>runPortfolioScenario(instruments,scores,1,study.parameters,study.scenarios[0]!,study.portfolio,100,10,undefined,4,100,undefined,plans)).toThrow(/Missing/);
});
