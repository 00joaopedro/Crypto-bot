import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assessEvolutionReadiness } from './hybrid-evolution-readiness.js';
const [reportPath,ledgerPath,experimentPath,policyPath,outDir,...extra]=process.argv.slice(2);
if(!reportPath||!ledgerPath||!experimentPath||!policyPath||!outDir||extra.length)throw new Error('Usage: strategy:hybrid-evolution-readiness -- <report.json> <ledgers.json> <experiment.json> <policy.json> <NEW-output-directory>; offline assessment only');
const [report,ledger,experiment,policy]=await Promise.all([readFile(reportPath,'utf8'),readFile(ledgerPath,'utf8'),readFile(experimentPath,'utf8'),readFile(policyPath,'utf8')]);
const result=assessEvolutionReadiness(report,ledger,experiment,JSON.parse(policy));
await mkdir(outDir,{recursive:false,mode:0o700});
await writeFile(join(outDir,'summary.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));
