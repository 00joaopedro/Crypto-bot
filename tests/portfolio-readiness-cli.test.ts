import { execFileSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { datasetHash,universeStudySchema } from '../src/universe-comparison.js';
it('assembles offline readiness and capital without replaying/combining profits, checks source identities and protects inputs',()=>{
 const root=mkdtempSync(join(tmpdir(),'portfolio-readiness-'));
 const read=(p:string)=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
 try{
  const dataDir=join(root,'data'),out=join(root,'out');mkdirSync(dataDir);
  const study=universeStudySchema.parse(read('examples/pullback-reference.study.json')),length=study.warmupCandles+2880,end=Date.parse(study.endExclusiveUtc);
  const assets=['BTC/USDT','ETH/USDT'].map(symbol=>{
   const d={symbol,constraints:{minimumNotionalUsdt:0,minimumQuantity:.001,quantityStep:.001},quoteVolumesUsdt:Array(length).fill(2e6),candles:Array.from({length},(_,i)=>({timestamp:end-(length-i)*900000,open:100,high:100.1,low:99.9,close:100,volume:20000}))};
   const filename=symbol.replace('/','-')+'.json';writeFileSync(join(dataDir,filename),JSON.stringify(d));return {symbol,filename,sha256:datasetHash(d)};
  });
  const paths=['docs/pullback-experiments.json','docs/volatility-exit-experiments.json','docs/confirmed-reversion-experiments.json','docs/financial-reference-current.json'].map((p,i)=>{
   // Synthetic internally coherent identity fixture; this test does not authenticate market performance.
   const d=read(p);d.datasetHashes=assets.map(({symbol,sha256})=>({symbol,sha256}));const path=join(root,`input${i}.json`);writeFileSync(path,JSON.stringify(d));return path;
  });
  const plan=read('examples/portfolio-readiness.plan.json'),planPath=join(root,'plan.json');writeFileSync(planPath,JSON.stringify(plan));
  const source=JSON.stringify({complete:true,studySha256:plan.sourceStudySha256,assets});writeFileSync(join(dataDir,'source.json'),source);
  const run=(dest=out)=>execFileSync(process.execPath,['--import','tsx',new URL('../src/portfolio-readiness-cli.ts',import.meta.url).pathname,planPath,...paths,dataDir,dest],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const result=JSON.parse(run());expect(result.status).toBe('blocked_no_eligible_candidate');expect(result.uniqueRows).toBe(32);expect(result.budget.rows).toHaveLength(10);expect(result.combination.allocatedUsdt).toBe(0);expect(result.budget.allocatedUsdt).toBe(0);expect(result.realMoneyApproved).toBe(false);
  expect(readFileSync(join(dataDir,'source.json'),'utf8')).toBe(source);expect(()=>run(dataDir)).toThrow(/replace/);
  writeFileSync(join(dataDir,assets[0]!.filename),'{}');expect(run).toThrow(/hash mismatch/);
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);
