import { execFileSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it,expect } from 'vitest';
import { semanticHash } from '../src/cost-experiments.js';
import { effectiveExecutionSnapshot } from '../src/execution-fidelity.js';
import { parseConfig } from '../src/config.js';
import { universeStudySchema,datasetHash } from '../src/universe-comparison.js';
it('diagnoses a verified frozen replay offline, preserves unknown fees, rejects altered reference/data and does not expose unrelated export fields',()=>{
 const root=mkdtempSync(join(tmpdir(),'economics-'));
 try{
  const dir=join(root,'data'),reference=join(root,'reference'),out=join(root,'out');mkdirSync(dir);
  const sourcePath=new URL('../examples/universe-validation.study.json',import.meta.url).pathname;
  const planPath=new URL('../examples/execution-costs.plan.json',import.meta.url).pathname;
  const study=universeStudySchema.parse(JSON.parse(readFileSync(sourcePath,'utf8'))),end=Date.parse(study.endExclusiveUtc),length=study.warmupCandles+2880;
  const assets=['BTC/USDT','ETH/USDT'].map(symbol=>{const d={symbol,constraints:{minimumNotionalUsdt:0,minimumQuantity:.001,quantityStep:.001},quoteVolumesUsdt:Array(length).fill(2e6),candles:Array.from({length},(_,i)=>({timestamp:end-(length-i)*900000,open:100,high:100,low:100,close:100,volume:20000}))};const filename=symbol.replace('/','-')+'.json';writeFileSync(join(dir,filename),JSON.stringify(d));return {symbol,filename,sha256:datasetHash(d)}});
  writeFileSync(join(dir,'source.json'),JSON.stringify({complete:true,studySha256:semanticHash(study),assets}));
  const diagnostic=join(root,'diag.json');
  const snapshot=effectiveExecutionSnapshot(parseConfig({OKX_DEMO_BOT_BUDGET_USDT:'5000'}),{symbol:'BTC/USDT',orderSizeUsdt:10,maxTrades:10,maxConcurrentPositions:10,intervalMinutes:15},undefined);
  writeFileSync(diagnostic,JSON.stringify({generatedAt:new Date().toISOString(),executionFidelity:{snapshot},records:[],notForOutput:'PRIVATE_VALUE'}));
  const call=(file:string,args:string[])=>execFileSync(process.execPath,['--import','tsx',new URL('../src/'+file,import.meta.url).pathname,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  call('execution-calibration-cli.ts',[planPath,sourcePath,dir,reference,diagnostic]);
  const baseline=join(reference,'summary.json');
  const run=()=>call('economic-diagnosis-cli.ts',[planPath,sourcePath,dir,baseline,out,diagnostic]);
  const result=JSON.parse(run());expect(result.coverage).toMatchObject({feeEvidenced:0,feesAssumed:2});expect(result.runs).toHaveLength(4);
  const full=readFileSync(join(out,'summary.json'),'utf8');expect(full).not.toContain('PRIVATE_VALUE');expect(JSON.parse(full).runs[0].ownedFavorableMoveRate.mean).toBeNull();
  const changed=JSON.parse(readFileSync(baseline,'utf8'));changed.scenarios[0].results[0].closedTrades=1;writeFileSync(baseline,JSON.stringify(changed));
  expect(run).toThrow(/baseline not reproduced/);
  writeFileSync(join(dir,assets[0]!.filename),'{}');expect(run).toThrow(/dataset hash mismatch/);
 }finally{rmSync(root,{recursive:true,force:true})}
},20000);
