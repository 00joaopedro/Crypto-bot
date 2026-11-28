import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { screenEconomicCandidates } from './hybrid-economic-screen.js';
const names=['A_REFERENCE','A_VOLUME_OFF','A_TOUCH_1_ATR','B_REFERENCE','B_NET_RR_1_5','B_ATR_OFF'] as const;
const costs=['account-conditioned','account-cost-stress'] as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/),number=z.number().finite(),count=number.int().nonnegative();
export const economicReadinessPolicySchema=z.object({protocol:z.literal('hybrid-economic-readiness-v1'),reportFileSha256:hash,ledgerFileSha256:hash,experimentFileSha256:hash,developmentDatasetSha256:hash,strategyPlanSha256:hash,minimumClosedTradesPerScenario:z.literal(30),purpose:z.literal('recompute_selection_no_execution_or_promotion')}).strict();
const block=z.object({name:z.enum(['D1-D10','D11-D20','D21-D30']),complete:z.literal(true),candles:z.literal(960),netReturnUsdt:number});
const row=z.object({name:z.enum(names),variant:z.enum(['trend_pullback','mean_reversion']),hypothesis:z.string().nullable(),scenario:z.enum(costs),closedTrades:count,netReturnUsdt:number,realizedPnlUsdt:number,finalEquityUsdt:number,feesUsdt:number.nonnegative(),profitFactor:number.nonnegative().nullable(),expectancyUsdt:number.nullable(),openPosition:z.unknown(),blocks:z.array(block).length(3)});
const reportSchema=z.object({protocol:z.literal('hybrid-economic-development-v1'),protocolFileSha256:hash,datasetSha256:hash,bankUsdt:z.literal(17),lotCeilingUsdt:z.literal(10),riskLimits:z.record(z.string(),number),runs:z.array(row).length(12)});
const trade=z.object({symbol:z.string(),strategy_mode:z.enum(['TREND_PULLBACK','MEAN_REVERSION']),entryTimestamp:count,exitTimestamp:count,netPnlUsdt:number,feesUsdt:number.nonnegative()});
const ledgerSchema=z.array(z.object({name:z.enum(names),scenario:z.enum(costs),entries:z.array(z.object({symbol:z.string(),strategy_mode:z.string(),entryTimestamp:count})),closedTradeLedger:z.array(trade)})).length(12);
const sum=(xs:number[])=>xs.reduce((a,b)=>a+b,0),near=(a:number,b:number)=>Math.abs(a-b)<=1e-8;
/** Pure evidence assessment: no collector, account client, executor or deployment API. */
export function assessEconomicReadiness(reportText:string,ledgerText:string,experimentText:string,rawPolicy:unknown){
 const policy=economicReadinessPolicySchema.parse(rawPolicy),sha=(s:string)=>createHash('sha256').update(s).digest('hex');
 if(sha(reportText)!==policy.reportFileSha256||sha(ledgerText)!==policy.ledgerFileSha256||sha(experimentText)!==policy.experimentFileSha256)throw new Error('Frozen economic evidence identity mismatch');
 const report=reportSchema.parse(JSON.parse(reportText)),ledgers=ledgerSchema.parse(JSON.parse(ledgerText)),experiment=JSON.parse(experimentText);
 if(report.datasetSha256!==policy.developmentDatasetSha256||experiment.datasetSha256!==policy.developmentDatasetSha256||report.protocolFileSha256!==policy.experimentFileSha256||experiment.strategyPlanSha256!==policy.strategyPlanSha256)throw new Error('Economic dataset/protocol identity mismatch');
 if(experiment.protocol!=='hybrid-economic-development-v1'||!isDeepStrictEqual(report.riskLimits,experiment.riskLimits)||experiment.criteria?.minimumClosedTradesEachScenario!==30)throw new Error('Economic risk/criteria identity mismatch');
 const ids=(rows:Array<{name:string;scenario:string}>)=>new Set(rows.map(r=>r.name+'/'+r.scenario));
 if(ids(report.runs).size!==12||ids(ledgers).size!==12)throw new Error('Complete unique economic matrix required');
 for(const r of report.runs){
  const expectedVariant=r.name.startsWith('A_')?'trend_pullback':'mean_reversion',expectedHypothesis=r.name.endsWith('_REFERENCE')?null:r.name;
  if(r.variant!==expectedVariant||r.hypothesis!==expectedHypothesis)throw new Error('Economic case identity mismatch');
  const l=ledgers.find(l=>l.name===r.name&&l.scenario===r.scenario)!;
  if(!l||l.closedTradeLedger.length!==r.closedTrades||l.entries.length!==r.closedTrades+(r.openPosition===null?0:1))throw new Error('Economic ledger/count mismatch');
  const mode=r.variant==='trend_pullback'?'TREND_PULLBACK':'MEAN_REVERSION';
  if(l.closedTradeLedger.some(t=>t.strategy_mode!==mode||t.exitTimestamp<t.entryTimestamp)||l.entries.some(t=>t.strategy_mode!==mode)||new Set(l.entries.map(t=>t.symbol+'/'+t.entryTimestamp)).size!==l.entries.length)throw new Error('Economic trade identity mismatch');
  const closedKeys=new Set<string>();
  for(const t of l.closedTradeLedger){const key=t.symbol+'/'+t.entryTimestamp;if(closedKeys.has(key)||!l.entries.some(e=>e.symbol===t.symbol&&e.entryTimestamp===t.entryTimestamp))throw new Error('Economic trade/entry mismatch');closedKeys.add(key);}
  const realized=sum(l.closedTradeLedger.map(t=>t.netPnlUsdt)),win=sum(l.closedTradeLedger.map(t=>Math.max(t.netPnlUsdt,0))),loss=sum(l.closedTradeLedger.map(t=>Math.max(-t.netPnlUsdt,0))),pf=loss>0?win/loss:null;
  if(!near(realized,r.realizedPnlUsdt)||(r.closedTrades===0?r.expectancyUsdt!==null:r.expectancyUsdt===null||!near(r.expectancyUsdt*r.closedTrades,realized))||(pf===null?r.profitFactor!==null:r.profitFactor===null||!near(pf,r.profitFactor)))throw new Error('Economic PF/expectancy/ledger mismatch');
  if(new Set(r.blocks.map(b=>b.name)).size!==3||!near(sum(r.blocks.map(b=>b.netReturnUsdt)),r.netReturnUsdt)||!near(r.finalEquityUsdt,17+r.netReturnUsdt))throw new Error('Economic blocks/equity mismatch');
  if(r.openPosition===null&&(!near(realized,r.netReturnUsdt)||!near(sum(l.closedTradeLedger.map(t=>t.feesUsdt)),r.feesUsdt)))throw new Error('Economic flat-wallet reconciliation mismatch');
 }
 const candidates=screenEconomicCandidates(report.runs),eligible=candidates.filter(c=>c.eligibleForFutureIndependentProtocol).map(c=>c.name);
 return {protocol:policy.protocol,status:eligible.length?'blocked_independent_and_operational_prerequisites':'blocked_no_eligible_candidate',evidence:{reportFileSha256:sha(reportText),ledgerFileSha256:sha(ledgerText),experimentFileSha256:sha(experimentText),developmentDatasetSha256:report.datasetSha256},matrixCases:12,candidates,eligibleForFutureIndependentProtocol:eligible,
  blockers:[...(eligible.length?[]:['no_eligible_development_candidate']),'independent_validation_not_performed','hybrid_native_demo_adapter_and_protection_not_validated','demo_balance_minima_and_access_require_confirmation','intended_real_spendable_balance_and_minimum_notional_unknown'],
  independentDataCollected:false,holdoutExecuted:false,configurationPromoted:false,demoIntegrationApproved:false,realMoneyApproved:false,ordersSent:0,paidAiCalls:false,
  ongoingPaper48h:{classification:'experimental_observation_not_financial_approval',recommendedAction:'finish_existing_frozen_window_if_healthy_then_archive',restartNow:false,updateRunningCommit:false,automaticNewSession:false,knownInterruption:'missing-confirmed-candle failure/recovery observed in supplied logs; not uninterrupted operation',completionEvidence:'completed checkpoint with full duration and reconciled ledger; elapsed clock alone is insufficient'},
  nextVersion:{separateSessionDirectoryRequired:true,freezeBeforeStart:['code','strategy','costs','universe','risk','criteria'],oldCheckpointMigrationApproved:false,rerun48hAutomatically:false},
  limitations:['Hash bindings identify the archived evidence, not authenticity of exchange fills or executable real-market profits.','Reconciles matrix, ledger, PF, EV, fees and aggregate blocks; does not reconstruct candles or prove each intra-block mark. Prior replay reproduction remains the source of those marks.','Favorable synthetic evidence only permits considering a future protocol. Independent validation and native Demo integration are still required.','Read-only fee quotes for19pairs were supplied earlier, but this assessment does not requery an account or certify spendable balance/minimum notional.','No command starts/stops a worker, sends orders, deploys a branch or approves money. Latest live health is separate from this deterministic report.']};
}
