import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { assessEvolutionReadiness } from '../src/hybrid-evolution-readiness.js';
const path=(p:string)=>new URL('../'+p,import.meta.url).pathname,text=(p:string)=>readFileSync(path(p),'utf8');
const reportText=text('docs/hybrid-evolution-results.json'),ledgerText=text('docs/hybrid-evolution-ledgers.json'),experimentText=text('examples/hybrid-evolution.plan.json'),policy=JSON.parse(text('examples/hybrid-evolution-readiness.plan.json'));
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function changed(fn:(r:any,l:any)=>void){const r=JSON.parse(reportText),l=JSON.parse(ledgerText);fn(r,l);const rt=JSON.stringify(r),lt=JSON.stringify(l);return assessEvolutionReadiness(rt,lt,experimentText,{...policy,reportFileSha256:sha(rt),ledgerFileSha256:sha(lt)});}
it('reconciles all26 archived cases including C and blocks orders, holdout and new48h sessions',()=>{
 const r=assessEvolutionReadiness(reportText,ledgerText,experimentText,policy);
 expect(r).toMatchObject({status:'blocked_no_eligible_candidate',matrixCases:26,eligibleForFutureIndependentProtocol:[],independentDataCollected:false,holdoutExecuted:false,demoIntegrationApproved:false,nativeDemoAdapterExecuted:false,realMoneyApproved:false,configurationPromoted:false,ordersSent:0,paidAiCalls:false});
 expect(r.candidates).toHaveLength(10);expect(r.paper48h).toMatchObject({automaticRestart:false,updateRunningCommit:false,automaticNewSession:false});expect(r.nextVersion.oldCheckpointMigrationApproved).toBe(false);
});
it('rejects modified bytes, dataset, protocol, risk and per-pair fee identity',()=>{
 for(const [r,l,e]of [[reportText+' ',ledgerText,experimentText],[reportText,ledgerText+' ',experimentText],[reportText,ledgerText,experimentText+' ']])expect(()=>assessEvolutionReadiness(r!,l!,e!,policy)).toThrow(/identity/);
 expect(()=>changed(r=>{r.datasetSha256='0'.repeat(64);})).toThrow(/identity/);
 expect(()=>changed(r=>{r.riskLimits.maxExposure=.5;})).toThrow();
 expect(()=>changed(r=>{r.scenarios[0].symbolCosts['UNI/USDT'].feeRate=.001;})).toThrow(/cost identity/);
});
it('ignores editable status/selection/real approval flags and requires an exact unique matrix',()=>{
 const r=changed(r=>{r.status='approved';r.realMoneyApproved=true;r.demoIntegrationApproved=true;r.selection.forEach((s:any)=>s.eligibleForFutureIndependentProtocol=true);});
 expect(r.eligibleForFutureIndependentProtocol).toEqual([]);expect(r.realMoneyApproved).toBe(false);
 expect(()=>changed(r=>{r.runs.pop();})).toThrow();expect(()=>changed(r=>{r.runs[0]=r.runs[1];})).toThrow(/matrix/);
 expect(()=>changed((r,l)=>{l[0]=l[1];})).toThrow(/matrix/);expect(()=>changed(r=>{r.runs[0].change='full';})).toThrow(/case/);
});
it('recomputes PF, EV, concentration, mode totals, blocks and recovery even with rebound hashes',()=>{
 for(const change of [(r:any)=>{r.runs[0].profitFactor=5;},(r:any)=>{r.runs[0].expectancyUsdt=1;},(r:any)=>{r.runs[0].realizedPnlWithoutTop3Usdt=1;},(r:any)=>{r.runs[0].top3TradesProfitSharePercent=0;},(r:any)=>{r.runs[0].byMode[1].closedTrades=0;},(r:any)=>{r.runs[0].blocks[0].closedTrades=1;},(r:any)=>{r.runs[0].blocks[0].netReturnUsdt=1;},(r:any)=>{r.runs[0].recoveryFactor=100;}])expect(()=>changed(change)).toThrow(/mismatch/);
});
it('reconciles modeled proceeds, fees, net cash, entries and single-position chronology',()=>{
 for(const field of ['grossProceedsUsdt','feesUsdt','netPnlUsdt'])expect(()=>changed((r,l)=>{l[0].closedTradeLedger[0][field]+=.01;})).toThrow(/reconciliation/);
 expect(()=>changed((r,l)=>{l[0].entries[1]=l[0].entries[0];})).toThrow(/identity/);
 expect(()=>changed((r,l)=>{l[0].closedTradeLedger[0].holdingCandles=1;})).toThrow(/identity/);
 expect(()=>changed((r,l)=>{l[0].closedTradeLedger[0].strategy_mode='MEAN_REVERSION';})).toThrow(/identity/);
 expect(()=>changed(r=>{r.runs[0].feesUsdt+=.01;})).toThrow(/flat-wallet/);
 expect(()=>changed(r=>{r.runs[0].capitalTimeUtilizationPercent=0;})).toThrow(/capital-time/);
});
it('rejects shared-position overlaps, fabricated open positions and incomplete C mode breakdown',()=>{
 expect(()=>changed((r,l)=>{const first=l[0].closedTradeLedger[0];first.exitTimestamp=l[0].entries[1].entryTimestamp;first.holdingCandles=(first.exitTimestamp-first.entryTimestamp)/900000+1;})).toThrow(/overlap/);
 expect(()=>changed(r=>{r.runs[0].openPosition={symbol:'BTC/USDT',strategy_mode:'TREND_PULLBACK',entryTimestamp:1794000000000,stopPrice:99,targetPrice:103};})).toThrow(/count/);
 expect(()=>changed(r=>{r.runs.find((c:any)=>c.name==='C_SQUEEZE').byMode.pop();})).toThrow(/mode breakdown/);
 expect(()=>changed((r,l)=>{l[0].entries[0].decisionTimestamp-=900000;})).toThrow(/identity/);
});
it('keeps internally consistent favorable synthetic evidence blocked on independent/native Demo prerequisites',()=>{
 const stats=(ts:any[])=>{const ps=ts.map(t=>t.netPnlUsdt),win=ps.filter(p=>p>0).reduce((a,b)=>a+b,0),loss=-ps.filter(p=>p<0).reduce((a,b)=>a+b,0),net=win-loss,top=ps.filter(p=>p>0).sort((a,b)=>b-a).slice(0,3),topSum=top.reduce((a,b)=>a+b,0);return {closedTrades:ts.length,realizedPnlUsdt:net,winRatePercent:ts.length?100*ps.filter(p=>p>0).length/ts.length:null,profitFactor:loss?win/loss:null,expectancyUsdt:ts.length?net/ts.length:null,topWinningTradePnLsUsdt:top,top3TradesProfitSharePercent:win?100*topSum/win:null,realizedPnlWithoutTop3Usdt:net-topSum};};
 const r=changed((r,l)=>{const start=Date.parse(r.asOfUtc)-30*86400000;for(const c of r.runs){
  const mode=c.variant==='squeeze'?'VOLATILITY_SQUEEZE':c.variant==='mean_reversion'?'MEAN_REVERSION':'TREND_PULLBACK',fee=c.scenario==='account-conditioned'?.004:.008,ledger=l.find((x:any)=>x.name===c.name&&x.scenario===c.scenario);
  ledger.entries=Array.from({length:30},(_,i)=>({symbol:'BTC/USDT',strategy_mode:mode,entryTimestamp:start+Math.floor(i/10)*10*86400000+(i%10)*2700000+900000,decisionTimestamp:start+Math.floor(i/10)*10*86400000+(i%10)*2700000,notionalUsdt:1}));
  ledger.closedTradeLedger=ledger.entries.map((e:any,i:number)=>{const gross=(i%10<7?1.2:.8)/(1-fee),quantity=.01;return {...e,quantity:quantity*(1-fee),exitPrice:gross/(quantity*(1-fee)),exitTimestamp:e.entryTimestamp+900000,grossProceedsUsdt:gross,feesUsdt:fee+gross*fee,netPnlUsdt:gross*(1-fee)-1,holdingCandles:2};});
  const s=stats(ledger.closedTradeLedger);Object.assign(c,s,{netReturnUsdt:s.realizedPnlUsdt,netReturnPercent:100*s.realizedPnlUsdt/17,finalEquityUsdt:17+s.realizedPnlUsdt,feesUsdt:ledger.closedTradeLedger.reduce((a:number,t:any)=>a+t.feesUsdt,0),maxDrawdownUsdt:.2,maxDrawdownPercent:1,recoveryFactor:s.realizedPnlUsdt/.2,openPosition:null,peakConcurrentPositions:1,heldMinutes:900,meanClosedHoldingMinutes:30,capitalTimeUtilizationPercent:100*900/43200});
  c.byMode=c.byMode.map((m:any)=>({...m,...stats(ledger.closedTradeLedger.filter((t:any)=>t.strategy_mode===m.strategy_mode))}));
  c.blocks=c.blocks.map((b:any,i:number)=>{const ts=ledger.closedTradeLedger.slice(i*10,i*10+10),s=stats(ts);return {...b,...s,netReturnUsdt:s.realizedPnlUsdt};});
 }});
 expect(r.eligibleForFutureIndependentProtocol).toHaveLength(10);expect(r.status).toBe('blocked_independent_and_operational_prerequisites');expect(r).toMatchObject({demoIntegrationApproved:false,realMoneyApproved:false,holdoutExecuted:false,ordersSent:0});
});
it('CLI reproduces the archived assessment and refuses overwriting existing evidence',()=>{
 const dir=mkdtempSync(join(tmpdir(),'evolution-ready-')),out=join(dir,'out');
 try{const args=['--import','tsx',path('src/hybrid-evolution-readiness-cli.ts'),path('docs/hybrid-evolution-results.json'),path('docs/hybrid-evolution-ledgers.json'),path('examples/hybrid-evolution.plan.json'),path('examples/hybrid-evolution-readiness.plan.json'),out];
  const result=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));expect(result).toEqual(JSON.parse(text('docs/hybrid-evolution-readiness.json')));
  expect(()=>execFileSync(process.execPath,args,{stdio:'pipe'})).toThrow(/EEXIST/);expect(JSON.parse(readFileSync(join(out,'summary.json'),'utf8'))).toEqual(result);
 }finally{rmSync(dir,{recursive:true,force:true});}
},15000);
