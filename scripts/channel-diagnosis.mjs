import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { diagnoseOpportunities } from '../dist/opportunity-diagnosis.js';
import { semanticHash } from '../dist/cost-experiments.js';
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const [sourcePath,resultDir,outputPath]=process.argv.slice(2);
if(!sourcePath||!resultDir||!outputPath||process.argv.length!==5)throw new Error('Usage: channel-diagnosis <source> <result-directory> <NEW-output.json>');
const data=json(sourcePath),protocol=json('examples/channel-continuation.plan.json'),cost=json(protocol.costProtocolFile),summary=json(resultDir+'/summary.json'),ledger=json(resultDir+'/ledgers.json');
if(semanticHash(data)!==protocol.sourceDatasetSha256||summary.sourceDatasetSha256!==protocol.sourceDatasetSha256||ledger.protocolFrozenCommit!==summary.protocolFrozenCommit||ledger.runs.length!==4)throw new Error('Channel attribution source mismatch');
const runs=ledger.runs.map(run=>{
 const scenario=cost.scenarios.find(s=>s.name===run.scenario);if(!scenario)throw new Error('Unknown cost scenario');
 const {rows,...diagnosis}=diagnoseOpportunities({entries:run.entries,trades:run.closedTradeLedger,instruments:data.instruments.filter(d=>protocol.universe.includes(d.symbol)),scenario,intervalMs:3600000});
 const expected=summary.runs.filter(r=>r.name===run.name&&r.scenario===run.scenario);
 if(expected.length!==1||diagnosis.summary.trades!==expected[0].closedTrades||Math.abs(diagnosis.summary.netPnlUsdt-expected[0].realizedPnlUsdt)>1e-8)throw new Error('Channel attribution ledger mismatch');
 return {name:run.name,scenario:run.scenario,...diagnosis};
});
const report={protocol:'channel-fixed-path-attribution-v1',protocolFrozenCommit:summary.protocolFrozenCommit,sourceDatasetSha256:summary.sourceDatasetSha256,ledgerFileSha256:createHash('sha256').update(readFileSync(resultDir+'/ledgers.json')).digest('hex'),runs,
 limitations:['Fixed same-trade/same-exit-reference attribution, not a strategy replay with cheaper fees. Gates, sizing and portfolio would change.','Modeled costs, not native fills. MFE/MAE exclude exit candle; forward windows can include post-exit prices.','Reference has no trades; zero P&L is not evidence of profitable edge. No parameters were changed after these results.'],ordersSent:0,realMoneyApproved:false};
writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log('Four channel/reference cases attributed without changing economic rules or selecting parameters.');
