import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { semanticHash } from './cost-experiments.js';
import { shadowConfiguration, shadowDataSchema, type ShadowSnapshot } from './hybrid-shadow-session.js';
import { auditShadowSession } from './hybrid-shadow-diagnostics.js';
import { diagnoseOpportunities, diagnoseBankCapacity } from './opportunity-diagnosis.js';
import type { HybridInstrument } from './hybrid-research-replay.js';

const [quarterPath,hourPath,checkpointPath,coveragePath,accountPath,outDir,...extra]=process.argv.slice(2);
if(!quarterPath||!hourPath||!checkpointPath||!coveragePath||!accountPath||!outDir||extra.length)throw new Error('Usage: strategy:opportunities -- <frozen-15m-data> <frozen-1h-data> <checkpoint.json> <public-coverage.json> <private-account-snapshot.json> <NEW-output-directory>; offline only');
const root=new URL('../',import.meta.url),json=async(p:string)=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const inputPaths={quarter:quarterPath,hour:hourPath,checkpoint:checkpointPath,coverage:coveragePath,account:accountPath};
const inputs:Record<string,{data:any;sha256:string}>=Object.fromEntries(await Promise.all(Object.entries(inputPaths).map(async([key,path])=>{const bytes=await readFile(path);return [key,{data:JSON.parse(bytes.toString()),sha256:createHash('sha256').update(bytes).digest('hex')}] as const;})));
const config=shadowConfiguration(await json('examples/hybrid-shadow.profile.json'),await json('examples/hybrid-research.plan.json'),await json('examples/pullback-reference.study.json'));
const quarter=shadowDataSchema.parse(inputs.quarter!.data),hour=inputs.hour!.data as {instruments:HybridInstrument[]};
const results=await Promise.all(['hybrid-economic','hybrid-evolution','trend-horizon'].map(async prefix=>({prefix,summary:await json(`docs/${prefix}-results.json`),ledgers:await json(`docs/${prefix}-ledgers.json`)})));
if(results.some(r=>r.summary.datasetSha256!==semanticHash(r.prefix==='trend-horizon'?hour:quarter)))throw new Error('Frozen dataset identity mismatch');
const state=inputs.checkpoint!.data as ShadowSnapshot,audit=auditShadowSession(config,state);
const horizonProtocol=await json('examples/trend-horizon.plan.json');
const runs=[],tradeRows=[];
for(const {prefix,summary,ledgers} of results){
 if(ledgers.length!==summary.runs.length)throw new Error('Frozen report/ledger matrix differs');
 for(const run of ledgers){
  const matches=summary.runs.filter((r:any)=>r.name===run.name&&r.scenario===run.scenario),metric=matches[0];
  if(matches.length!==1)throw new Error('Unknown or duplicate frozen result');
  const scenarios=prefix==='trend-horizon'?horizonProtocol.scenarios:summary.scenarios;
  const scenario=scenarios.find((s:any)=>s.name===run.scenario);if(!scenario)throw new Error('Unknown frozen scenario');
  const {rows,...diagnosis}=diagnoseOpportunities({entries:run.entries,trades:run.closedTradeLedger,instruments:prefix==='trend-horizon'?hour.instruments:quarter.instruments,scenario,intervalMs:prefix==='trend-horizon'?3600000:900000});
  if(diagnosis.summary.trades!==metric.closedTrades||Math.abs(diagnosis.summary.netPnlUsdt-metric.realizedPnlUsdt)>1e-8||Math.abs(diagnosis.summary.recordedFeesUsdt-metric.feesUsdt)>1e-8)throw new Error('Closed ledger does not reconcile to archived metrics');
  const identity={study:prefix,name:run.name,scenario:run.scenario};runs.push({...identity,...diagnosis});tradeRows.push({...identity,rows});
 }
}
const {rows,...sessionDiagnosis}=diagnoseOpportunities({entries:audit.metrics!.entries,trades:audit.metrics!.closedTradeLedger,instruments:state.data.instruments,scenario:config.scenario,intervalMs:900000});
const observedAtUtc=new Date().toISOString(),capacity=diagnoseBankCapacity(inputs.account!.data,state.data.instruments,config.profile.riskLimits,Date.parse(observedAtUtc));
const sources=Object.fromEntries(Object.entries(inputs).map(([key,v])=>[key,{sha256:v.sha256}]));
const archivedSources=Object.fromEntries(await Promise.all(results.flatMap(({prefix})=>['results','ledgers'].map(async suffix=>{const p=`docs/${prefix}-${suffix}.json`;return [p,createHash('sha256').update(await readFile(new URL(p,root))).digest('hex')];}))));
const report={protocol:'opportunity-cost-diagnosis-v1',observedAtUtc,status:'diagnosis_complete_account_refresh_pending',sources,archivedSources,
 runs,session:{checkpointSha256:state.checkpointSha256,sourceFileSha256:inputs.checkpoint!.sha256,status:audit.status,asOfUtc:audit.asOfUtc,...sessionDiagnosis,balance:audit.balance,funnel:audit.funnel,admissions:audit.admissions,coverage:inputs.coverage!.data},capacity,
 nextDecision:'No strategy selected or modified. Freeze one distinct economic hypothesis only after reviewing this diagnosis and resolving cost uncertainty.',
 accountRefresh:{performed:false,reason:'This offline command consumes a supplied dated snapshot; refreshing authenticated account evidence is a separate operation.',missingEvidence:['fresh real maker and taker quotes per candidate pair','usable trading cash with liability/mode confirmation','applicable minimum notional and fresh quantity/price rules','current book/spread/depth'],publicRefreshPerformed:false},
 limitations:[
  'All data are development data already consulted. Cases overlap and repeat reference trades: never pool counts or profits across cases, periods or scenarios as independent evidence.',
  'Reference-path P&L removes modeled fill friction and fees while keeping the SAME selected trades, exit references and notional. It is attribution, not a zero-cost strategy replay: admissions, target/stop/trailing and cash paths would change.',
  'Before-fees at fixed fills restores pre-buy-fee quantity. Adding recorded USDT fees to net P&L differs when the buy fee is base-denominated and that base moves in price. Both quantities and the revaluation residual are reported.',
  'Spread and slippage are frozen scenario assumptions jointly embedded in fill prices, not separately observed exchange costs. Entry/exit attribution exactly reconciles; no claim about actual maker fills or historical queue priority.',
  'MFE/MAE exclude the entire exit candle; same-candle exits are unknown, not zero. Forward windows can include post-exit prices and overlap; they are diagnostic, not achievable returns or independent signals.',
  'Per-symbol/session groups describe accepted trades only; they do not select winners or justify dropping losing pairs/hours. No independent liquidity ranking is possible from these candles.',
  'Capacity uses dated real-account rules and last supplied candle prices, planned 17-USDT equity, no positions, and exposure ceilings only. Stop risk/liquidity/saldo/fees at execution can reduce size. Missing minimum notional, maker, usable cash or book never becomes zero or permission to trade.',
  'Public coverage does not certify Demo instrument availability. Self-declared stored code fingerprints do not authenticate the old binary or prove uninterrupted 48-hour uptime.',
 ],ordersSent:0,paidAiCalls:false,configurationPromoted:false,realMoneyApproved:false};
await mkdir(outDir,{recursive:false,mode:0o700});
await writeFile(join(outDir,'summary.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
await writeFile(join(outDir,'trade-attribution.json'),JSON.stringify({protocol:report.protocol,sources,archivedSources,runs:tradeRows,session:rows,ordersSent:0,realMoneyApproved:false},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:report.status,cases:runs.length,session:sessionDiagnosis.summary,capacityPairs:capacity.rows.length,conditionalQuantityPass:capacity.rows.filter(r=>r.conditionalQuantityPass===true).length,liveTradingEligible:0,accountRefreshPerformed:false,ordersSent:0}));
