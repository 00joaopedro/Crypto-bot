import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {parseConfig} from '../src/config.js';
import {effectiveExecutionSnapshot} from '../src/execution-fidelity.js';
import {universeStudySchema,datasetHash} from '../src/universe-comparison.js';
it('builds a reproducible cost reference offline, preserves frozen data and refuses a bad dataset hash',()=>{
 const root=mkdtempSync(join(tmpdir(),'cost-reference-'));
 try{
  const original=universeStudySchema.parse(JSON.parse(readFileSync(new URL('../examples/universe-validation.study.json',import.meta.url),'utf8')));
  const dir=join(root,'data'),out=join(root,'out');mkdirSync(dir);
  const end=Date.parse(original.endExclusiveUtc),length=original.warmupCandles+2880;
  const assets=['BTC/USDT','ETH/USDT'].map(symbol=>{const data={symbol,constraints:{minimumNotionalUsdt:0,minimumQuantity:.00001,quantityStep:.00001},quoteVolumesUsdt:Array(length).fill(2e6),candles:Array.from({length},(_,i)=>({timestamp:end-(length-i)*900000,open:100,high:100,low:100,close:100,volume:20000}))};const filename=symbol.replace('/','-')+'.json';writeFileSync(join(dir,filename),JSON.stringify(data));return {symbol,filename,sha256:datasetHash(data)}});
  const source={complete:true,studySha256:createHash('sha256').update(JSON.stringify(original)).digest('hex'),assets};const sourcePath=join(dir,'source.json');writeFileSync(sourcePath,JSON.stringify(source));
  const snapshot=effectiveExecutionSnapshot(parseConfig({OKX_DEMO_BOT_BUDGET_USDT:'5000'}),{symbol:'BTC/USDT',orderSizeUsdt:10,maxTrades:10,maxConcurrentPositions:10,intervalMinutes:15},undefined);
  const diagnosticPath=join(root,'diagnostic.json');writeFileSync(diagnosticPath,JSON.stringify({generatedAt:new Date().toISOString(),records:[],executionFidelity:{snapshot}}));
  const run=()=>execFileSync(process.execPath,['--import','tsx',new URL('../src/execution-calibration-cli.ts',import.meta.url).pathname,new URL('../examples/execution-costs.plan.json',import.meta.url).pathname,new URL('../examples/universe-validation.study.json',import.meta.url).pathname,dir,out,diagnosticPath],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const summary=JSON.parse(run());expect(summary.status).toBe('financial_reference_only');expect(summary.coverage.feesAssumed).toBe(2);expect(summary.universeCoverage.requestedSizesCoveredByPool).toBe(false);
  expect(summary.scenarios[0].results[0].closedTrades).toBe(0);expect(summary.reference.parameters.exitPolicy.mode).toBe('fixed');
  expect(JSON.parse(readFileSync(sourcePath,'utf8'))).toEqual(source);
  writeFileSync(join(dir,assets[0]!.filename),'{}');expect(run).toThrow(/Frozen dataset hash mismatch/);
 }finally{rmSync(root,{recursive:true,force:true})}
},15000);
