import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { assessHybridDemoReadiness } from '../src/hybrid-demo-readiness.js';
const path=(p:string)=>new URL('../'+p,import.meta.url).pathname;
const text=readFileSync(path('docs/hybrid-research-results.json'),'utf8'),strategy=JSON.parse(readFileSync(path('examples/hybrid-research.plan.json'),'utf8')),policy=JSON.parse(readFileSync(path('examples/hybrid-demo-readiness.plan.json'),'utf8'));
function synthetic(change:(r:any)=>void){const r=JSON.parse(text);change(r);const t=JSON.stringify(r);return assessHybridDemoReadiness(t,strategy,{...policy,developmentReportFileSha256:createHash('sha256').update(t).digest('hex')});}
it('recomputes the archived account-cost decision and preserves explicit 48h blockers',()=>{
 const r=assessHybridDemoReadiness(text,strategy,policy);
 expect(r.status).toBe('blocked_no_eligible_candidate');expect(r.preliminaryEligibleVariants).toEqual([]);expect(r.costScenarios).toEqual(['account-conditioned','account-cost-stress']);
 expect(r.candidates.find(c=>c.variant==='hybrid')!.cases[0]).toMatchObject({closedTrades:19});
 expect(r.blockers).toContain('hybrid_operational_entry_and_exit_adapter_not_validated');expect(r.blockers).toContain('17_usdt_10_usdt_lot_runtime_risk_compatibility_unverified');
 expect(r).toMatchObject({paidAiRequired:false,paidAiCalls:false,demo48hStarted:false,operationalIntegrationCompleted:false,configurationPromoted:false,realMoneyApproved:false});
 expect(r.future48hProtocol.automaticRealMoneyApproval).toBe(false);
});
it('rejects altered report bytes, strategy identity and dataset identity',()=>{
 expect(()=>assessHybridDemoReadiness(text+' ',strategy,policy)).toThrow(/identity/);
 expect(()=>assessHybridDemoReadiness(text,strategy,{...policy,strategyPlanSha256:'0'.repeat(64)})).toThrow(/identity/);
 expect(()=>synthetic(r=>{r.datasetSha256='0'.repeat(64);})).toThrow(/dataset/);
});
it('ignores edited approval/status flags and rejects incomplete or inconsistent economic evidence',()=>{
 expect(synthetic(r=>{r.realMoneyApproved=true;r.configurationPromoted=true;r.status='approved';}).preliminaryEligibleVariants).toEqual([]);
 expect(()=>synthetic(r=>{r.runs=r.runs.filter((x:any)=>!(x.variant==='hybrid'&&x.scenario==='account-cost-stress'));})).toThrow(/matrix/);
 expect(()=>synthetic(r=>{r.runs.find((x:any)=>x.scenario==='account-conditioned').blocks[0].netReturnUsdt+=1;})).toThrow(/reconcile/);
 expect(()=>synthetic(r=>{r.runs.find((x:any)=>x.scenario==='account-conditioned').expectancyUsdt=100;})).toThrow(/expectancy/);
});
it('does not promote favorable synthetic economics without independent and operational evidence',()=>{
 const r=synthetic(r=>{for(const c of r.runs){if(!policy.costScenarios.includes(c.scenario))continue;c.closedTrades=30;c.netReturnUsdt=3;c.realizedPnlUsdt=3;c.expectancyUsdt=.1;c.profitFactor=2;for(const b of c.blocks){b.netReturnUsdt=1;b.profitFactor=2;}}});
 expect(r.preliminaryEligibleVariants).toHaveLength(3);expect(r.status).toBe('blocked_operational_and_independent_prerequisites');expect(r.configurationPromoted).toBe(false);expect(r.demo48hStarted).toBe(false);expect(r.realMoneyApproved).toBe(false);
});
it('keeps undefined PF and tiny samples from becoming approval, and rejects duplicate blocks',()=>{
 const r=synthetic(r=>{for(const c of r.runs){if(!policy.costScenarios.includes(c.scenario))continue;c.closedTrades=1;c.netReturnUsdt=3;c.realizedPnlUsdt=3;c.expectancyUsdt=3;c.profitFactor=null;for(const b of c.blocks){b.netReturnUsdt=1;b.profitFactor=null;}}});
 expect(r.preliminaryEligibleVariants).toEqual([]);expect(r.candidates.every(c=>!c.sufficientSample)).toBe(true);
 expect(()=>synthetic(r=>{const c=r.runs.find((x:any)=>x.scenario==='account-conditioned');c.blocks[1].name=c.blocks[0].name;})).toThrow(/reconcile/);
});
it('CLI reproduces the archived readiness output without touching account or deployment, refusing overwrite',()=>{
 const root=mkdtempSync(join(tmpdir(),'hybrid-readiness-')),out=join(root,'out');
 try{
 const args=['--import','tsx',path('src/hybrid-demo-readiness-cli.ts'),path('docs/hybrid-research-results.json'),path('examples/hybrid-research.plan.json'),path('examples/hybrid-demo-readiness.plan.json'),out];
 const result=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));
 expect(result).toEqual(JSON.parse(readFileSync(path('docs/hybrid-demo-readiness.json'),'utf8')));
 expect(()=>execFileSync(process.execPath,args,{stdio:'pipe'})).toThrow(/EEXIST/);
 }finally{rmSync(root,{recursive:true,force:true});}
},10000);
