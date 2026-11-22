import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { assessPortfolioReadiness,assessReferenceBudgets } from '../src/portfolio-readiness.js';
import { universeStudySchema,type UniverseDataset } from '../src/universe-comparison.js';
import { semanticHash } from '../src/cost-experiments.js';
const read=(p:string)=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const reports=()=>['docs/pullback-experiments.json','docs/volatility-exit-experiments.json','docs/confirmed-reversion-experiments.json'].map(read);
const financial=()=>read('docs/financial-reference-current.json'),plan=()=>read('examples/portfolio-readiness.plan.json');
function positive(rows:any[],variant:string){for(const r of rows.filter(r=>r.variant===variant))Object.assign(r,{netReturnUsdt:10,realizedPnlUsdt:10,profitFactor:2,closedTrades:40,expectancyUsdt:.25,maxDrawdownUsdt:3,recoveryFactor:10/3,top3TradesProfitSharePercent:20,realizedPnlWithoutTop3Usdt:7,blocks:[{netReturnUsdt:4,closedTrades:20,profitFactor:2},{netReturnUsdt:6,closedTrades:20,profitFactor:2}]});}
it('recomputes all three actual reports and removes repeated baselines, without inventing a combined P&L',()=>{
 const r=assessPortfolioReadiness(reports(),financial(),plan());
 expect(r).toMatchObject({status:'blocked_no_eligible_candidate',inputRows:40,uniqueRows:32,repeatedBaselineRowsRemoved:8,eligibleVariants:[],eligibleStrategies:[],holdoutExecuted:false,configurationPromoted:false,realMoneyApproved:false});
 expect(r.candidates).toHaveLength(8);expect(r.combination).toMatchObject({simulationExecuted:false,combinedExecutionImplemented:false,allocation:null,allocatedUsdt:0});
 expect(r.results.filter(x=>x.variant==='reference')).toHaveLength(4);
});
it('ignores editable approval flags and blocks the zero-trade and least-negative candidates',()=>{
 const data=reports();for(const r of data)r.readiness={status:'approved',candidates:[],configurationPromoted:true,realMoneyApproved:true};
 const r=assessPortfolioReadiness(data,financial(),plan());expect(r.eligibleVariants).toEqual([]);
 expect(r.candidates.find(c=>c.variant==='confirmed-mean-reversion')!.reasons.some(s=>s.includes('small_sample'))).toBe(true);
 expect(r.candidates.find(c=>c.variant==='atr-floor-0.75')!.passesDevelopmentScreen).toBe(false);
});
it('rejects missing runs, duplicates, incomplete sources and mismatched source/configuration/dataset identity',()=>{
 for(const mutate of [(d:any[])=>d[0].results.pop(),(d:any[])=>{d[0].results[1]=d[0].results[0];},(d:any[])=>{d[1].referenceConfigurationHash='a'.repeat(64);},(d:any[])=>{d[2].datasetHashes[0].sha256='a'.repeat(64);},(d:any[])=>{d[0].datasetHashes.push(d[0].datasetHashes[0]);},(d:any[])=>{d[1].protocol.minimumClosedTradesPerRun=1;}]){
 const data=reports();mutate(data);expect(()=>assessPortfolioReadiness(data,financial(),plan())).toThrow();
 }
 expect(()=>assessPortfolioReadiness(reports().slice(1),financial(),plan())).toThrow(/source/);
});
it('rejects metrics that no longer reconcile to blocks, expectancy or the archived baseline',()=>{
 const b=reports();b[1].results[0].blocks[0].netReturnUsdt+=1;expect(()=>assessPortfolioReadiness(b,financial(),plan())).toThrow(/blocks/);
 const e=reports();e[0].results[4].expectancyUsdt=1;expect(()=>assessPortfolioReadiness(e,financial(),plan())).toThrow(/expectancy/);
 const f=financial();f.scenarios[0].results[0].profitFactor=.9;expect(()=>assessPortfolioReadiness(reports(),f,plan())).toThrow(/baseline/);
 const duplicate=financial();duplicate.scenarios[0].results[1]=duplicate.scenarios[0].results[0];expect(()=>assessPortfolioReadiness(reports(),duplicate,plan())).toThrow(/baseline/);
});
it('allows one strategy to advance conditionally without requiring a second or allocating 50/50',()=>{
 const data=reports();positive(data[1].results,'atr-floor-0.75');positive(data[1].results,'net-trailing-no-target');
 const r=assessPortfolioReadiness(data,financial(),plan());expect(r.status).toBe('single_strategy_selection_protocol_required');expect(r.eligibleStrategies).toEqual(['trend']);expect(r.combination.allocation).toBeNull();expect(r.configurationPromoted).toBe(false);
});
it('two synthetic passing strategies require a new combination protocol, not automatic combination or real approval',()=>{
 const data=reports();positive(data[1].results,'atr-floor-0.75');positive(data[2].results,'confirmed-mean-reversion');
 const r=assessPortfolioReadiness(data,financial(),plan());expect(r.status).toBe('combination_protocol_required');expect(r.eligibleStrategies).toHaveLength(2);expect(r.combination.simulationExecuted).toBe(false);expect(r.realMoneyApproved).toBe(false);
});
it('binds protocol and reference hashes instead of accepting a changed allocation/capital plan',()=>{
 const data=reports();data[0].protocolSha256=semanticHash({fake:true});expect(()=>assessPortfolioReadiness(data,financial(),plan())).toThrow(/identity/);
 expect(()=>assessPortfolioReadiness(reports(),financial(),{...plan(),allocationPolicy:'50/50'})).toThrow();
});
function capitalData(){
 const study=universeStudySchema.parse(read('examples/pullback-reference.study.json')),length=study.warmupCandles+2880,end=Date.parse(study.endExclusiveUtc);
 const datasets:UniverseDataset[]=['BTC/USDT','ETH/USDT'].map(symbol=>({symbol,constraints:{minimumNotionalUsdt:0,minimumQuantity:.001,quantityStep:.001},quoteVolumesUsdt:Array(length).fill(2e6),candles:Array.from({length},(_,i)=>({timestamp:end-(length-i)*900000,open:100,high:100.2,low:99.8,close:100,volume:20000}))}));return {study,datasets};
}
it('preserves the fixed lot and shared exposure: small capital rejects rather than silently reducing lot size',()=>{
 const {study,datasets}=capitalData();const r=assessReferenceBudgets(datasets,study,[10,20,50,100,5000]);
 expect(r.rows.filter(r=>r.equityUsdt<=50).every(r=>r.feasibleFixedLotSymbols===0)).toBe(true);
 expect(r.rows.filter(r=>r.equityUsdt>=100).every(r=>r.feasibleFixedLotSymbols===2)).toBe(true);
 expect(r.rows.filter(r=>r.equityUsdt===100).every(r=>r.nominalLotSlots===1)).toBe(true);
 expect(r.allocatedUsdt).toBe(0);expect(r.intendedCapitalAssessment).toMatch(/unconfirmed/);expect(r.zeroNotionalMinimumSymbols).toHaveLength(2);
});
it('checks sellable post-fee minimums, minimum value, quantity precision and alt exposure separately',()=>{
 const {study,datasets}=capitalData();datasets[1]!.constraints.minimumQuantity=.099;
 expect(assessReferenceBudgets(datasets,study,[5000]).rows[0]!.rejected.minimum).toContain('ETH/USDT');
 datasets[1]!.constraints.minimumQuantity=.001;datasets[1]!.constraints.minimumNotionalUsdt=11;
 expect(assessReferenceBudgets(datasets,study,[5000]).rows[0]!.rejected.minimum).toContain('ETH/USDT');
 datasets[1]!.constraints.minimumNotionalUsdt=0;study.portfolio.maxAltExposureRate=.05;
 const limited=assessReferenceBudgets(datasets,study,[100]).rows[0]!;expect(limited.feasibleSymbols).toEqual(['BTC/USDT']);expect(limited.rejected.exposure).toContain('ETH/USDT');
 expect(()=>assessReferenceBudgets(datasets,study,[0])).toThrow(/Invalid budget/);expect(()=>assessReferenceBudgets(datasets,study,[10,10])).toThrow(/Invalid budget/);
});
it('reserves quote entry fees in cash admission and does not treat recorded zero minimum as live verification',()=>{
 const {study,datasets}=capitalData();study.tradeSizeUsdt=1000;
 for(const scenario of study.scenarios)for(const symbol of ['BTC/USDT','ETH/USDT'])scenario.symbolCosts![symbol]!.entryFeeCurrency='quote';
 const r=assessReferenceBudgets(datasets,study,[1000]);expect(r.rows.every(row=>row.rejected.cash!.length===2)).toBe(true);
 expect(r.intendedCapitalAssessment).toBe('blocked_spendable_usdt_and_current_terms_unconfirmed');expect(r.allocationExecuted).toBe(false);
});
