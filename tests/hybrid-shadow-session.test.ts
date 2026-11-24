import { auditShadowSession } from '../src/hybrid-shadow-diagnostics.js';
import { readFileSync,mkdtempSync,rmSync,statSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect,it } from 'vitest';
import { shadowConfiguration,startShadowSession,advanceShadowSession } from '../src/hybrid-shadow-session.js';
import { lockShadowSession,readShadowCheckpoint,saveShadowCheckpoint } from '../src/hybrid-shadow-store.js';
import { semanticHash } from '../src/cost-experiments.js';
const file=(p:string)=>new URL('../'+p,import.meta.url).pathname;
const profile=JSON.parse(readFileSync(file('examples/hybrid-shadow.profile.json'),'utf8')),plan=JSON.parse(readFileSync(file('examples/hybrid-research.plan.json'),'utf8')),reference=JSON.parse(readFileSync(file('examples/pullback-reference.study.json'),'utf8'));
const config=shadowConfiguration(profile,plan,reference),code='a'.repeat(64),start=1000*900000;
function frame(n:number){
 const all=Array.from({length:1192},(_,i)=>({timestamp:i*900000,open:100,high:101,low:99,close:100,volume:20000}));
 all[999]={timestamp:999*900000,open:100,high:100,low:94,close:95,volume:20000};all[1000]={timestamp:1000*900000,open:95,high:99,low:94.5,close:98,volume:20000};
 for(let i=1001;i<all.length;i++)all[i]={timestamp:i*900000,open:98,high:98.5,low:97.5,close:98,volume:20000};
 const candles15m=all.slice(0,n),candles1h=[];
 for(let i=0;i+3<n;i+=4){const q=all.slice(i,i+4);candles1h.push({timestamp:q[0]!.timestamp,open:q[0]!.open,high:Math.max(...q.map(c=>c.high)),low:Math.min(...q.map(c=>c.low)),close:q[3]!.close,volume:q.reduce((s,c)=>s+c.volume,0)});}
 return {asOfUtc:new Date(n*900000).toISOString(),instruments:[{symbol:'BTC/USDT',candles15m,candles1h,quoteVolumesUsdt:candles15m.map(c=>c.close*c.volume),constraints:{minimumNotionalUsdt:0,minimumQuantity:.0001,quantityStep:.0001}}]};
}
const begin=()=>startShadowSession(config,frame(1000),code,start);
it('initializes only from fresh warmup and requires the separate Paper-only risk profile',()=>{
 const s=begin();expect(s.result).toBeNull();expect(s.status).toBe('warming');expect(s.ordersSent).toBe(0);
 expect(()=>startShadowSession(config,frame(1004),code,start+3600000)).toThrow(/warmup/);
 expect(()=>startShadowSession(config,frame(1000),code,start+900001)).toThrow(/Fresh/);
 expect(()=>shadowConfiguration({...profile,environment:'demo'},plan,reference)).toThrow();
 expect(()=>shadowConfiguration({...profile,riskLimits:{...profile.riskLimits,maxExposure:.6}},plan,reference)).toThrow();
});
it('uses real indicators to enter B, preserves one wallet and smaller risk-compatible lot, then time-stops across restart',()=>{
 const one=advanceShadowSession(config,begin(),frame(1004),code,1004*900000);
 expect(one.result!.openPosition!.strategy_mode).toBe('MEAN_REVERSION');expect(one.result!.entries).toHaveLength(1);expect(one.result!.entries[0]!.notionalUsdt).toBeLessThanOrEqual(2.55);
 expect(one.result!.entries[0]!.estimatedInitialLossUsdt).toBeLessThanOrEqual(.17);expect(one.result!.peakConcurrentPositions).toBe(1);
 const restored=JSON.parse(JSON.stringify(one)),next=advanceShadowSession(config,restored,frame(1007),code,1007*900000),direct=advanceShadowSession(config,begin(),frame(1007),code,1007*900000);
 expect(next.result).toEqual(direct.result);expect(next.result!.closedTradeLedger[0]).toMatchObject({strategy_mode:'MEAN_REVERSION',reason:'TIME_STOP',holdingCandles:6});expect(next.ordersSent).toBe(0);
});
it('treats repeated closed snapshots as idempotent, refuses code/config changes and corrupted checkpoints',()=>{
 const s=advanceShadowSession(config,begin(),frame(1004),code,1004*900000);
 expect(advanceShadowSession(config,s,frame(1004),code,1004*900000)).toEqual(s);
 expect(()=>advanceShadowSession(config,s,frame(1004),'b'.repeat(64),1004*900000)).toThrow(/identity/);
 expect(()=>advanceShadowSession({...config,configurationHash:'b'.repeat(64)},s,frame(1004),code,1004*900000)).toThrow(/identity/);
 const corrupt=JSON.parse(JSON.stringify(s));corrupt.result.netReturnUsdt=100;expect(()=>advanceShadowSession(config,corrupt,frame(1004),code,1004*900000)).toThrow(/corruption/);
 corrupt.resultSha256=semanticHash(corrupt.result);const {checkpointSha256,...body}=corrupt;corrupt.checkpointSha256=semanticHash(body);expect(()=>advanceShadowSession(config,corrupt,frame(1004),code,1004*900000)).toThrow(/ledger/);
});
it('blocks rewritten past observations, missing candles, changed coverage and future snapshots',()=>{
 const s=advanceShadowSession(config,begin(),frame(1004),code,1004*900000);
 const changed=frame(1007);changed.instruments[0]!.candles15m[900]!.volume=21000;changed.instruments[0]!.candles1h[225]!.volume=81000;changed.instruments[0]!.quoteVolumesUsdt[900]=2100000;
 expect(()=>advanceShadowSession(config,s,changed,code,1007*900000)).toThrow(/rewritten/);
 const gap=frame(1007);gap.instruments[0]!.candles15m.splice(1005,1);expect(()=>advanceShadowSession(config,s,gap,code,1007*900000)).toThrow(/window/);
 const coverage=frame(1007);coverage.instruments[0]!.symbol='ETH/USDT';expect(()=>advanceShadowSession(config,s,coverage,code,1007*900000)).toThrow(/rewritten/);
 expect(()=>advanceShadowSession(config,s,frame(1007),code,1007*900000-1)).toThrow(/cutoff/);
});
it('completes 48 hours only after both candle coverage and wall-clock duration, without promoting real or Demo trading',()=>{
 const first=startShadowSession(config,frame(1000),code,start+60000);
 const early=advanceShadowSession(config,first,frame(1192),code,1192*900000);expect(early.status).toBe('observing');
 const done=advanceShadowSession(config,early,frame(1192),code,1192*900000+60000);expect(done.status).toBe('completed');expect(done.realMoneyApproved).toBe(false);expect(done.ordersSent).toBe(0);
});
it('durably checkpoints, excludes concurrent workers, and refuses corrupted JSON without overwriting',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hybrid-shadow-'));
 try{const release=await lockShadowSession(root);await expect(lockShadowSession(root)).rejects.toThrow(/EEXIST/);
 expect(await readShadowCheckpoint(root)).toBeNull();await saveShadowCheckpoint(root,begin());expect(await readShadowCheckpoint(root)).toEqual(begin());expect(statSync(join(root,'checkpoint.json')).mode&0o777).toBe(0o600);
 await release();const second=await lockShadowSession(root);await second();
 writeFileSync(join(root,'checkpoint.json'),'{corrupt');await expect(readShadowCheckpoint(root)).rejects.toThrow();expect(readFileSync(join(root,'checkpoint.json'),'utf8')).toBe('{corrupt');
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('CLI rejects a trading-mode argument before creating any session or calling the network',()=>{
 const root=mkdtempSync(join(tmpdir(),'hybrid-shadow-args-'));
 try{expect(()=>execFileSync(process.execPath,['--import','tsx',file('src/hybrid-shadow-cli.ts'),join(root,'session'),'--demo'],{stdio:'pipe'})).toThrow(/Paper only/);expect(()=>statSync(join(root,'session'))).toThrow();}finally{rmSync(root,{recursive:true,force:true});}
});

it('accepts a real quarter-hour start with only completed hourly context, without inventing a partial hour',()=>{
 const full=frame(1004),d=full.instruments[0]!;
 const data={asOfUtc:new Date(1001*900000).toISOString(),instruments:[{...d,candles15m:d.candles15m.slice(1,1001),quoteVolumesUsdt:d.quoteVolumesUsdt.slice(1,1001),candles1h:d.candles1h.slice(0,250)}]};
 expect(startShadowSession(config,data,code,1001*900000).status).toBe('warming');
});

it('reconstructs signal/admission funnels and reconciles the full ledger without changing the checkpoint',()=>{
 const state=advanceShadowSession(config,begin(),frame(1007),code,1007*900000),before=JSON.stringify(state),report=auditShadowSession(config,state);
 expect(JSON.stringify(state)).toBe(before);expect(report.metrics).toEqual(state.result);expect(report.balance.finalEquityUsdt).toBeCloseTo(17+report.balance.netReturnUsdt,10);
 expect(report.ledger).toHaveLength(1);expect(report.ledger[0]!.reason).toBe('TIME_STOP');expect(report.ledger[0]!.netBeforeChargedFeesUsdt).toBeCloseTo(report.ledger[0]!.netPnlUsdt+report.ledger[0]!.feesUsdt,12);
 expect(report.admissions.filter(e=>e.outcome==='accepted').reduce((s,e)=>s+e.count,0)).toBe(state.result!.entries.length);
 for(const row of report.funnel){expect(row.candles).toBe(6);const stages=Object.values(row.sequentialPassed);expect(stages.every((n,i)=>i===0||n<=stages[i-1]!)).toBe(true);expect(row.signals).toBe(stages.at(-1));}
});
it('refuses diagnostic output from an altered ledger and explains warmup without inventing trades',()=>{
 const state=advanceShadowSession(config,begin(),frame(1007),code,1007*900000),corrupt=JSON.parse(JSON.stringify(state));corrupt.result.closedTrades=99;
 expect(()=>auditShadowSession(config,corrupt)).toThrow(/corruption/);const r=auditShadowSession(config,begin());expect(r.balance.netReturnUsdt).toBe(0);expect(r.admissions).toEqual([]);expect(r.ledger).toEqual([]);expect(r.funnel.every(f=>f.candles===0)).toBe(true);
});
it('excludes an ambiguous exit-candle spike from favorable excursion instead of calling it attainable profit',()=>{
 const data=frame(1007);data.instruments[0]!.candles15m[1006]!.high=999;
 const state=advanceShadowSession(config,begin(),data,code,1007*900000),trade=auditShadowSession(config,state).ledger[0]!;
 expect(trade.excursion.exitCandleExcluded).toBe(true);expect(trade.excursion.candles).toBe(5);expect(trade.excursion.mfeRate).toBeLessThan(.02);
});
it('audits a copied checkpoint through the CLI without modifying source or requiring account credentials',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hybrid-audit-'));
 try{
  await saveShadowCheckpoint(root,advanceShadowSession(config,begin(),frame(1007),code,1007*900000));const before=readFileSync(join(root,'checkpoint.json'),'utf8');
  const output=join(root,'audit');execFileSync(process.execPath,['--import','tsx',file('src/hybrid-shadow-audit-cli.ts'),root,output],{stdio:'pipe'});
  const report=JSON.parse(readFileSync(join(output,'diagnostics.json'),'utf8'));expect(report.ledger).toHaveLength(1);expect(report.collectionEvidence.status).toBe('unavailable_in_supplied_directory');expect(report.sourceFileSha256).toMatch(/^[a-f0-9]{64}$/);expect(report.ordersSent).toBe(0);expect(readFileSync(join(root,'checkpoint.json'),'utf8')).toBe(before);
 }finally{rmSync(root,{recursive:true,force:true});}
});
