import { execFileSync } from 'node:child_process';
import { mkdtempSync,readFileSync,writeFileSync,rmSync,readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { validateHybridInputs } from '../src/hybrid-research-replay.js';
const path=(p:string)=>new URL('../'+p,import.meta.url).pathname;
const plan=JSON.parse(readFileSync(path('examples/hybrid-research.plan.json'),'utf8'));
function fixture(){
 const quarters=Array.from({length:1008},(_,i)=>({timestamp:i*900000,open:100,high:100.5,low:99.5,close:100,volume:20000}));
 const hours=Array.from({length:252},(_,i)=>({...quarters[i*4]!,volume:80000}));
 return {asOfUtc:new Date(1008*900000).toISOString(),instruments:[{symbol:'BTC/USDT',candles15m:quarters,candles1h:hours,constraints:{minimumNotionalUsdt:0,minimumQuantity:.001,quantityStep:.001}}]};
}
it('validates both clocks, cross-timeframe consistency and closed-hour warmup; rejects gaps/duplicates instead of fabricating data',()=>{
 const d=fixture();expect(validateHybridInputs(d.instruments,plan).bankUsdt).toBe(17);
 const mismatch=fixture();mismatch.instruments[0]!.candles1h[1]!.high=102;expect(()=>validateHybridInputs(mismatch.instruments,plan)).toThrow(/disagree/);
 const gap=fixture();gap.instruments[0]!.candles15m.splice(12,1);expect(()=>validateHybridInputs(gap.instruments,plan)).toThrow(/contiguous/);
 const hour=fixture();hour.instruments[0]!.candles1h.shift();expect(()=>validateHybridInputs(hour.instruments,plan)).toThrow(/250/);
});
it('describes the frozen protocol without market data, API calls or changing runtime defaults',()=>{
 const output=JSON.parse(execFileSync(process.execPath,['--import','tsx',path('src/hybrid-research-cli.ts'),path('examples/hybrid-research.plan.json'),path('examples/pullback-reference.study.json')],{encoding:'utf8'}));
 expect(output).toMatchObject({status:'offline_hybrid_protocol_only',profitabilityValidated:false,liveScannerChanged:false,configurationPromoted:false,realMoneyApproved:false});expect(output.plan.watchlist).toHaveLength(20);expect(output.baselineParameters.minimumSignalScore).toBe(4);
});
it('replays supplied synthetic data with four variants and only account-reference/stress costs by default; retains missing coverage and null metrics',()=>{
 const root=mkdtempSync(join(tmpdir(),'hybrid-research-'));
 try{
 const data=fixture(),dataPath=join(root,'data.json'),out=join(root,'out');writeFileSync(dataPath,JSON.stringify(data));
 const args=[process.execPath,['--import','tsx',path('src/hybrid-research-cli.ts'),path('examples/hybrid-research.plan.json'),path('examples/pullback-reference.study.json'),dataPath,out]] as const;
 const run=()=>execFileSync(args[0],[...args[1]],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const r=JSON.parse(run());expect(r.runs).toHaveLength(8);expect(r.missingFromInput).toHaveLength(19);expect(r.demoAvailabilityVerified).toBe(false);expect(r.paidAiCalls).toBe(false);expect(r.scenarios.map((s:any)=>s.name)).toEqual(['account-conditioned','account-cost-stress']);expect(r.runs.every((x:any)=>x.closedTrades===0&&x.profitFactor===null&&x.blocks.every((b:any)=>!b.complete))).toBe(true);expect(readdirSync(out)).toHaveLength(9);
 expect(run).toThrow(/EEXIST/);
 const wrong=join(root,'wrong-study.json');const base=JSON.parse(readFileSync(path('examples/pullback-reference.study.json'),'utf8'));base.tradeSizeUsdt=20;writeFileSync(wrong,JSON.stringify(base));
 expect(()=>execFileSync(process.execPath,['--import','tsx',path('src/hybrid-research-cli.ts'),path('examples/hybrid-research.plan.json'),wrong],{stdio:'pipe'})).toThrow(/identity/);
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);

it('keeps archived hypotheses opt-in for historical reproduction without AI calls',()=>{
 const r=JSON.parse(execFileSync(process.execPath,['--import','tsx',path('src/hybrid-research-cli.ts'),path('examples/hybrid-research.plan.json'),path('examples/pullback-reference.study.json'),'--include-cost-hypotheses'],{encoding:'utf8'}));
 expect(r.costScope).toBe('archived_full_matrix');expect(r.paidAiCalls).toBe(false);
});
