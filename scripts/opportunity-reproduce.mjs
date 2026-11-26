import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { diagnoseOpportunities } from '../dist/opportunity-diagnosis.js';
import { shadowDataSchema } from '../dist/hybrid-shadow-session.js';
import { semanticHash } from '../dist/cost-experiments.js';
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const [quarterPath,hourPath]=process.argv.slice(2);
if(!quarterPath||!hourPath||process.argv.length!==4)throw new Error('Two frozen data paths required');
const quarter=shadowDataSchema.parse(json(quarterPath)),hour=json(hourPath),archived=json('docs/opportunity-cost-diagnosis.json'),reproduced=[];
for(const prefix of ['hybrid-economic','hybrid-evolution','trend-horizon']){
 const summary=json(`docs/${prefix}-results.json`),ledgers=json(`docs/${prefix}-ledgers.json`),data=prefix==='trend-horizon'?hour:quarter;
 if(semanticHash(data)!==summary.datasetSha256)throw new Error('Frozen source changed');
 const scenarios=prefix==='trend-horizon'?json('examples/trend-horizon.plan.json').scenarios:summary.scenarios;
 for(const run of ledgers){
  const scenario=scenarios.find(s=>s.name===run.scenario);if(!scenario)throw new Error('Missing archived scenario');
  const {rows,...diagnosis}=diagnoseOpportunities({entries:run.entries,trades:run.closedTradeLedger,instruments:data.instruments,scenario,intervalMs:prefix==='trend-horizon'?3600000:900000});
  reproduced.push({study:prefix,name:run.name,scenario:run.scenario,...diagnosis});
 }
}
if(reproduced.length!==42||!isDeepStrictEqual(reproduced,archived.runs))throw new Error('Opportunity attribution changed');
console.log('42 archived development cases reproduced exactly; overlapping references were not pooled. This does not reproduce the separate user checkpoint or refresh private account data.');
