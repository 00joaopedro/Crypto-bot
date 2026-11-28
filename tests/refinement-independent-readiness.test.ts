import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { assessRefinementIndependentReadiness,requireRefinementFreezeReadiness } from '../src/refinement-independent-readiness.js';
import { assessPortfolioReadiness,portfolioReadinessPlanSchema } from '../src/portfolio-readiness.js';
const files=['docs/pullback-experiments.json','docs/volatility-exit-experiments.json','docs/confirmed-reversion-experiments.json'];
const path=(p:string)=>new URL('../'+p,import.meta.url).pathname,read=(p:string)=>JSON.parse(readFileSync(path(p),'utf8'));
const reports=()=>files.map(read),financial=()=>read('docs/financial-reference-current.json'),plan=()=>read('examples/portfolio-readiness-17usdt.plan.json'),source=()=>read('examples/universe-validation.study.json');
it('records planned 17 USDT, preserves the 5000 reference and blocks the real negative candidates without new data',()=>{
 const r=assessRefinementIndependentReadiness(reports(),financial(),plan(),source());
 expect(r).toMatchObject({status:'blocked_no_eligible_candidate',referenceCapitalUsdt:5000,declaredIntendedCapital:{currency:'USDT',amount:17,fundingStatus:'planned_not_verified',spendableUsdt:null},independentDataCollected:false,newWindowSelected:false,holdoutExecuted:false,freezePrepared:false,configurationPromoted:false,realMoneyApproved:false});
 expect(r.blockers).toContain('no_eligible_development_candidate');expect(r.blockers).toContain('declared_capital_not_replayed_in_development');expect(r.consultedDevelopmentWindow.includesWarmup).toBe(true);expect(r.minimumWarmupCandles).toBe(672);
 expect(()=>requireRefinementFreezeReadiness(r)).toThrow(/No eligible/);
});
it('keeps the old BRL protocol reproducible while the new USDT plan adds a distinct 17 scenario',()=>{
 expect(portfolioReadinessPlanSchema.parse(read('examples/portfolio-readiness.plan.json')).protocol).toBe('portfolio-readiness-v1');
 const p=portfolioReadinessPlanSchema.parse(plan());expect(p.capitalScenariosUsdt).toContain(17);expect(p.intendedCapital.amount).toBe(17);
 expect(assessPortfolioReadiness(reports(),financial(),p).eligibleVariants).toEqual([]);
});
it('recomputes numerical eligibility even when stored flags claim independent or real approval',()=>{
 const data=reports();data.forEach(r=>{r.readiness={status:'approved',realMoneyApproved:true,configurationPromoted:true};r.holdoutExecuted=true;});
 expect(assessRefinementIndependentReadiness(data,financial(),plan(),source()).eligibleVariants).toEqual([]);
 const changed=source();changed.days=31;expect(()=>assessRefinementIndependentReadiness(reports(),financial(),plan(),changed)).toThrow();
});
it('a synthetic development pass still cannot establish stability, account costs or a blind protocol',()=>{
 const data=reports();for(const r of data[1].results.filter((r:any)=>r.variant==='atr-floor-0.75'))Object.assign(r,{netReturnUsdt:10,realizedPnlUsdt:10,profitFactor:2,closedTrades:40,expectancyUsdt:.25,maxDrawdownUsdt:3,recoveryFactor:10/3,top3TradesProfitSharePercent:20,realizedPnlWithoutTop3Usdt:7,blocks:[{netReturnUsdt:4,closedTrades:20,profitFactor:2},{netReturnUsdt:6,closedTrades:20,profitFactor:2}]});
 const r=assessRefinementIndependentReadiness(data,financial(),plan(),source());expect(r.status).toBe('blocked_independent_preconditions_missing');expect(r.eligibleVariants).toEqual(['atr-floor-0.75']);expect(()=>requireRefinementFreezeReadiness(r)).toThrow(/prerequisites/);expect(r.holdoutExecuted).toBe(false);
});
it('CLI reports readiness without market access and rejects BEFORE opening a proposed new freeze',()=>{
 const root=mkdtempSync(join(tmpdir(),'refinement-readiness-'));
 try{
 const args=[path('examples/portfolio-readiness-17usdt.plan.json'),...files.map(path),path('docs/financial-reference-current.json'),path('examples/universe-validation.study.json'),root];
 const run=(extra:string[]=[])=>execFileSync(process.execPath,['--import','tsx',path('src/refinement-independent-readiness-cli.ts'),...args,...extra],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 expect(JSON.parse(run()).status).toBe('blocked_no_eligible_candidate');expect(()=>run(['--prepare-freeze',join(root,'unopened-independent-proposal.json')])).toThrow(/No eligible development candidate/);
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);
