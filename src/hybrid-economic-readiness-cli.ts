import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assessEconomicReadiness } from './hybrid-economic-readiness.js';
const [reportPath,ledgerPath,experimentPath,policyPath,outDir,...extra]=process.argv.slice(2);
if(!reportPath||!ledgerPath||!experimentPath||!policyPath||!outDir||extra.length)throw new Error('Usage: strategy:hybrid-economic-readiness -- <report.json> <ledgers.json> <experiment.json> <policy.json> <NEW-output-directory>; assessment only');
const [report,ledger,experiment,policy]=await Promise.all([readFile(reportPath,'utf8'),readFile(ledgerPath,'utf8'),readFile(experimentPath,'utf8'),readFile(policyPath,'utf8')]);
const result=assessEconomicReadiness(report,ledger,experiment,JSON.parse(policy));
await mkdir(outDir,{recursive:false});await writeFile(join(outDir,'summary.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
