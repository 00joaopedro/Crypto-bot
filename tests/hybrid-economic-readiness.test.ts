import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { assessEconomicReadiness } from '../src/hybrid-economic-readiness.js';
const path=(p:string)=>new URL('../'+p,import.meta.url).pathname;
const text=(p:string)=>readFileSync(path(p),'utf8');
const reportText=text('docs/hybrid-economic-results.json'),ledgerText=text('docs/hybrid-economic-ledgers.json'),experimentText=text('examples/hybrid-economic-experiments.plan.json'),policy=JSON.parse(text('examples/hybrid-economic-readiness.plan.json'));
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function changed(change:(r:any,l:any,e:any)=>void){const r=JSON.parse(reportText),l=JSON.parse(ledgerText),e=JSON.parse(experimentText);change(r,l,e);const rt=JSON.stringify(r),lt=JSON.stringify(l),et=JSON.stringify(e)===JSON.stringify(JSON.parse(experimentText))?experimentText:JSON.stringify(e);return assessEconomicReadiness(rt,lt,et,{...policy,reportFileSha256:sha(rt),ledgerFileSha256:sha(lt),experimentFileSha256:sha(et)});}
it('recomputes the full archived matrix and blocks promotion, holdout and automatic restart',()=>{
 const r=assessEconomicReadiness(reportText,ledgerText,experimentText,policy);
 expect(r.status).toBe('blocked_no_eligible_candidate');expect(r.matrixCases).toBe(12);expect(r.eligibleForFutureIndependentProtocol).toEqual([]);expect(r.candidates).toHaveLength(4);
 expect(r).toMatchObject({ordersSent:0,holdoutExecuted:false,independentDataCollected:false,configurationPromoted:false,demoIntegrationApproved:false,realMoneyApproved:false});
 expect(r.ongoingPaper48h).toMatchObject({restartNow:false,updateRunningCommit:false,automaticNewSession:false});expect(r.nextVersion.separateSessionDirectoryRequired).toBe(true);
});
it('refuses altered bytes, unrelated datasets, risk and protocol identities',()=>{
 expect(()=>assessEconomicReadiness(reportText+' ',ledgerText,experimentText,policy)).toThrow(/identity/);
 expect(()=>assessEconomicReadiness(reportText,ledgerText+' ',experimentText,policy)).toThrow(/identity/);
 expect(()=>assessEconomicReadiness(reportText,ledgerText,experimentText+' ',policy)).toThrow(/identity/);
 expect(()=>changed(r=>{r.datasetSha256='0'.repeat(64);})).toThrow(/identity/);
 expect(()=>changed((r,l,e)=>{r.riskLimits.maxExposure=.6;})).toThrow(/risk/);
});
it('ignores editable approval and selection flags rather than trusting them',()=>{
 const r=changed(r=>{r.status='approved';r.realMoneyApproved=true;r.configurationPromoted=true;r.selection=r.selection.map((s:any)=>({...s,eligibleForFutureIndependentProtocol:true}));});
 expect(r.eligibleForFutureIndependentProtocol).toEqual([]);expect(r.realMoneyApproved).toBe(false);
});
it('requires a unique complete matrix and exact case/variant identity',()=>{
 expect(()=>changed(r=>{r.runs.pop();})).toThrow();expect(()=>changed(r=>{r.runs[0]=r.runs[1];})).toThrow(/matrix/);
 expect(()=>changed(r=>{r.runs[0].variant='mean_reversion';})).toThrow(/case/);
 expect(()=>changed((r,l)=>{l[0]=l[1];})).toThrow(/matrix/);
});
it('rejects forged expectancy, PF, blocks and final equity even with rebound source hashes',()=>{
 for(const change of [(r:any)=>{r.runs[0].expectancyUsdt=1;},(r:any)=>{r.runs[0].profitFactor=3;},(r:any)=>{r.runs[0].blocks[0].netReturnUsdt=1;},(r:any)=>{r.runs[0].finalEquityUsdt=100;}])expect(()=>changed(change)).toThrow(/mismatch/);
});
it('reconciles trades, entries, fees and realized P&L, refusing duplicate trade identities',()=>{
 expect(()=>changed((r,l)=>{l[0].closedTradeLedger[0].netPnlUsdt+=.01;})).toThrow(/mismatch/);
 expect(()=>changed((r,l)=>{l[0].closedTradeLedger[0].feesUsdt+=.01;})).toThrow(/reconciliation/);
 expect(()=>changed((r,l)=>{l[0].entries[1]=l[0].entries[0];})).toThrow(/identity/);
 expect(()=>changed((r,l)=>{l[0].closedTradeLedger[1]=l[0].closedTradeLedger[0];})).toThrow(/entry mismatch/);
});
it('keeps favorable synthetic economics blocked on independent/native Demo prerequisites',()=>{
 const r=changed((r,l)=>{for(const c of r.runs){
  const mode=c.variant==='trend_pullback'?'TREND_PULLBACK':'MEAN_REVERSION',start=Date.parse('2026-10-24T00:00:00Z');const ledger=l.find((x:any)=>x.name===c.name&&x.scenario===c.scenario);
  ledger.entries=Array.from({length:30},(_,i)=>({symbol:'BTC/USDT',strategy_mode:mode,entryTimestamp:start+i*2700000}));
  ledger.closedTradeLedger=ledger.entries.map((e:any,i:number)=>({...e,exitTimestamp:e.entryTimestamp+900000,feesUsdt:.01,netPnlUsdt:i<20?.2:-.2}));
  Object.assign(c,{closedTrades:30,realizedPnlUsdt:2,netReturnUsdt:2,finalEquityUsdt:19,feesUsdt:.3,expectancyUsdt:2/30,profitFactor:2,openPosition:null});for(const b of c.blocks)b.netReturnUsdt=2/3;
 }});
 expect(r.eligibleForFutureIndependentProtocol).toHaveLength(4);expect(r.status).toBe('blocked_independent_and_operational_prerequisites');expect(r.demoIntegrationApproved).toBe(false);expect(r.realMoneyApproved).toBe(false);expect(r.holdoutExecuted).toBe(false);
});
it('CLI reproduces the archived decision offline and refuses overwriting an existing output',()=>{
 const dir=mkdtempSync(join(tmpdir(),'economic-readiness-')),out=join(dir,'out');
 try{const args=['--import','tsx',path('src/hybrid-economic-readiness-cli.ts'),path('docs/hybrid-economic-results.json'),path('docs/hybrid-economic-ledgers.json'),path('examples/hybrid-economic-experiments.plan.json'),path('examples/hybrid-economic-readiness.plan.json'),out];
  const r=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));expect(r).toEqual(JSON.parse(text('docs/hybrid-economic-readiness.json')));expect(()=>execFileSync(process.execPath,args,{stdio:'pipe'})).toThrow(/EEXIST/);
 }finally{rmSync(dir,{recursive:true,force:true});}
},15000);
