import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { EVOLUTION_CASES,screenEvolution } from './hybrid-evolution-screen.js';
const hash=z.string().regex(/^[a-f0-9]{64}$/),num=z.number().finite(),count=num.int().nonnegative(),positive=num.positive(),nonnegative=num.nonnegative();
const modes=['BASELINE','TREND_PULLBACK','MEAN_REVERSION','VOLATILITY_SQUEEZE'] as const,costs=['account-conditioned','account-cost-stress'] as const;
const risk=z.object({riskPerTrade:z.literal(.01),maxExposure:z.literal(.25),maxAltExposure:z.literal(.1),maxSymbolExposure:z.literal(.15)}).strict();
export const evolutionReadinessPolicySchema=z.object({protocol:z.literal('hybrid-evolution-readiness-v1'),reportFileSha256:hash,ledgerFileSha256:hash,experimentFileSha256:z.literal('21819470719e6bc5f7d33a5493ddb49f408c9d94af011cd1fa2fcc36d5e94f49'),developmentDatasetSha256:z.literal('fb88541a351e706edcc838fffdd42ed9a11ba25ace8d4a883d8090ed6eaadfc4'),strategyPlanSha256:z.literal('8af5316ef7b6774f4c66c2d3a4fcc792abd2ed34a77b41fa9a1c35eaf876fce9'),purpose:z.literal('reconcile_latest_evidence_no_collection_orders_or_promotion')}).strict();
const stats=z.object({closedTrades:count,realizedPnlUsdt:num,winRatePercent:nonnegative.max(100).nullable(),profitFactor:nonnegative.nullable(),expectancyUsdt:num.nullable(),topWinningTradePnLsUsdt:z.array(positive).max(3),top3TradesProfitSharePercent:nonnegative.max(100.0000001).nullable(),realizedPnlWithoutTop3Usdt:num});
const block=stats.extend({name:z.enum(['D1-D10','D11-D20','D21-D30']),complete:z.literal(true),candles:z.literal(960),netReturnUsdt:num});
const open=z.object({symbol:z.string(),strategy_mode:z.enum(modes),entryTimestamp:count,stopPrice:positive,targetPrice:positive});
const row=stats.extend({name:z.string(),variant:z.string(),change:z.string(),scenario:z.enum(costs),riskLimits:risk,dailyLossHaltRate:z.literal(.03),drawdownHaltRate:z.literal(.1),netReturnUsdt:num,netReturnPercent:num,finalEquityUsdt:nonnegative,feesUsdt:nonnegative,maxDrawdownUsdt:nonnegative,maxDrawdownPercent:nonnegative,recoveryFactor:num.nullable(),peakExposureRate:nonnegative.max(.25),peakConcurrentPositions:count.max(1),byMode:z.array(stats.extend({strategy_mode:z.enum(modes)})),blocks:z.array(block).length(3),openPosition:open.nullable(),heldMinutes:nonnegative,meanClosedHoldingMinutes:positive.nullable(),capitalTimeUtilizationPercent:nonnegative.max(100)});
const fee=z.object({feeRate:nonnegative.lt(1),entryFeeCurrency:z.enum(['base','quote'])});
const reportSchema=z.object({protocol:z.literal('hybrid-evolution-development-v1'),protocolFileSha256:hash,datasetSha256:hash,asOfUtc:z.iso.datetime(),includedSymbols:z.array(z.string()).min(1).max(20),bankUsdt:z.literal(17),lotCeilingUsdt:z.literal(10),riskLimits:risk,scenarios:z.array(z.object({name:z.enum(costs),feeRate:nonnegative,symbolCosts:z.record(z.string(),fee)})).length(2),runs:z.array(row).length(26)});
const entry=z.object({symbol:z.string(),strategy_mode:z.enum(modes),decisionTimestamp:count,entryTimestamp:count,notionalUsdt:positive.max(10.00000001)});
const trade=z.object({symbol:z.string(),strategy_mode:z.enum(modes),entryTimestamp:count,exitTimestamp:count,quantity:positive,exitPrice:positive,grossProceedsUsdt:positive,netPnlUsdt:num,feesUsdt:nonnegative,holdingCandles:count.positive()});
const ledgerSchema=z.array(z.object({name:z.string(),scenario:z.enum(costs),entries:z.array(entry),closedTradeLedger:z.array(trade)})).length(26);
const sha=(s:string)=>createHash('sha256').update(s).digest('hex'),sum=(xs:number[])=>xs.reduce((a,b)=>a+b,0),near=(a:number,b:number)=>Math.abs(a-b)<=1e-8;
const nullableNear=(a:number|null,b:number|null)=>a===null?b===null:b!==null&&near(a,b);
function checkStats(r:z.infer<typeof stats>,trades:Array<{netPnlUsdt:number}>){
 const ps=trades.map(t=>t.netPnlUsdt),net=sum(ps),win=sum(ps.map(p=>Math.max(0,p))),loss=sum(ps.map(p=>Math.max(0,-p))),top=ps.filter(p=>p>0).sort((a,b)=>b-a).slice(0,3);
 if(r.closedTrades!==ps.length||!near(r.realizedPnlUsdt,net)||!nullableNear(r.expectancyUsdt,ps.length?net/ps.length:null)||!nullableNear(r.profitFactor,loss?win/loss:null)||!nullableNear(r.winRatePercent,ps.length?100*ps.filter(p=>p>0).length/ps.length:null)||!nullableNear(r.top3TradesProfitSharePercent,win?100*sum(top)/win:null)||!near(r.realizedPnlWithoutTop3Usdt,net-sum(top))||r.topWinningTradePnLsUsdt.length!==top.length||top.some((v,i)=>!near(v,r.topWinningTradePnLsUsdt[i]!)))throw new Error('Evolution ledger/PF/EV/concentration mismatch');
}
/** Pure assessment. No imports of collectors, account clients, PaperTrader or exchange executors. */
export function assessEvolutionReadiness(reportText:string,ledgerText:string,experimentText:string,rawPolicy:unknown){
 const policy=evolutionReadinessPolicySchema.parse(rawPolicy);
 if(sha(reportText)!==policy.reportFileSha256||sha(ledgerText)!==policy.ledgerFileSha256||sha(experimentText)!==policy.experimentFileSha256)throw new Error('Frozen evolution evidence identity mismatch');
 const r=reportSchema.parse(JSON.parse(reportText)),ledgers=ledgerSchema.parse(JSON.parse(ledgerText)),experiment=JSON.parse(experimentText);
 if(r.datasetSha256!==policy.developmentDatasetSha256||experiment.datasetSha256!==policy.developmentDatasetSha256||experiment.strategyPlanSha256!==policy.strategyPlanSha256||r.protocolFileSha256!==policy.experimentFileSha256||!isDeepStrictEqual(experiment.riskLimits,r.riskLimits))throw new Error('Evolution dataset/protocol/risk identity mismatch');
 const ids=(xs:Array<{name:string;scenario:string}>)=>new Set(xs.map(x=>x.name+'/'+x.scenario));
 if(ids(r.runs).size!==26||ids(ledgers).size!==26||new Set(r.scenarios.map(s=>s.name)).size!==2||new Set(r.includedSymbols).size!==r.includedSymbols.length)throw new Error('Complete unique evolution matrix/universe required');
 const end=Date.parse(r.asOfUtc),start=end-30*86400000;
 for(const c of r.runs){
  const expected=EVOLUTION_CASES.find(x=>x[0]===c.name),l=ledgers.find(x=>x.name===c.name&&x.scenario===c.scenario);
  if(!expected||expected[1]!==c.variant||expected[2]!==c.change||!isDeepStrictEqual(c.riskLimits,r.riskLimits))throw new Error('Evolution case/risk identity mismatch');
  if(!l||l.entries.length!==c.closedTrades+(c.openPosition===null?0:1))throw new Error('Evolution ledger/count mismatch');
  const allowed=c.variant==='squeeze'?['VOLATILITY_SQUEEZE']:c.variant==='hybrid'?['TREND_PULLBACK','MEAN_REVERSION']:[c.variant==='trend_pullback'?'TREND_PULLBACK':'MEAN_REVERSION'];
  const key=(t:{symbol:string;entryTimestamp:number})=>t.symbol+'/'+t.entryTimestamp,entryKeys=new Set(l.entries.map(key)),closedKeys=new Set(l.closedTradeLedger.map(key));
  if(entryKeys.size!==l.entries.length||closedKeys.size!==l.closedTradeLedger.length||l.entries.some(e=>!allowed.includes(e.strategy_mode)||!r.includedSymbols.includes(e.symbol)||e.entryTimestamp%900000||e.decisionTimestamp!==e.entryTimestamp-900000||e.entryTimestamp<start||e.entryTimestamp>=end)||l.closedTradeLedger.some(t=>!allowed.includes(t.strategy_mode)||!entryKeys.has(key(t))||t.exitTimestamp<t.entryTimestamp||t.exitTimestamp%900000||t.exitTimestamp>=end||t.holdingCandles!==(t.exitTimestamp-t.entryTimestamp)/900000+1))throw new Error('Evolution trade/entry identity mismatch');
  const scenario=r.scenarios.find(s=>s.name===c.scenario)!,expectedFee=c.scenario==='account-conditioned'?.004:.008;
  if(scenario.feeRate!==expectedFee)throw new Error('Evolution cost identity mismatch');
  const sorted=[...l.entries].sort((a,b)=>a.entryTimestamp-b.entryTimestamp);
  for(let i=0;i<sorted.length;i++){
   const e=sorted[i]!,t=l.closedTradeLedger.find(t=>key(t)===key(e)),fc=scenario.symbolCosts[e.symbol];
   if(!fc||fc.feeRate!==expectedFee||fc.entryFeeCurrency!=='base')throw new Error('Evolution per-pair cost identity mismatch');
   if(i>0){const prior=l.closedTradeLedger.find(t=>key(t)===key(sorted[i-1]!));if(!prior||e.entryTimestamp<=prior.exitTimestamp)throw new Error('Evolution shared-position overlap');}
   if(t){if(t.strategy_mode!==e.strategy_mode||!near(t.grossProceedsUsdt,t.quantity*t.exitPrice)||!near(t.feesUsdt,e.notionalUsdt*fc.feeRate+t.grossProceedsUsdt*fc.feeRate)||!near(t.netPnlUsdt,t.grossProceedsUsdt*(1-fc.feeRate)-e.notionalUsdt))throw new Error('Evolution modeled cash/fees reconciliation mismatch');}
   else if(!c.openPosition||key(c.openPosition)!==key(e)||c.openPosition.strategy_mode!==e.strategy_mode)throw new Error('Evolution open-position identity mismatch');
  }
  checkStats(c,l.closedTradeLedger);
  const expectedModes=c.variant==='squeeze'?modes:modes.slice(0,3);
  if(c.byMode.length!==expectedModes.length||new Set(c.byMode.map(m=>m.strategy_mode)).size!==expectedModes.length||c.byMode.some(m=>!expectedModes.includes(m.strategy_mode)))throw new Error('Evolution mode breakdown mismatch');
  for(const m of c.byMode)checkStats(m,l.closedTradeLedger.filter(t=>t.strategy_mode===m.strategy_mode));
  if(new Set(c.blocks.map(b=>b.name)).size!==3||!near(sum(c.blocks.map(b=>b.netReturnUsdt)),c.netReturnUsdt)||!near(c.finalEquityUsdt,17+c.netReturnUsdt)||!near(c.netReturnPercent,100*c.netReturnUsdt/17)||!nullableNear(c.recoveryFactor,c.maxDrawdownUsdt>0?c.netReturnUsdt/c.maxDrawdownUsdt:null))throw new Error('Evolution blocks/equity/recovery mismatch');
  for(const b of c.blocks){const n=['D1-D10','D11-D20','D21-D30'].indexOf(b.name),from=start+n*10*86400000;checkStats(b,l.closedTradeLedger.filter(t=>t.exitTimestamp>=from&&t.exitTimestamp<from+10*86400000));}
  const minutes=sum(l.closedTradeLedger.map(t=>t.holdingCandles*15)),openMinutes=c.openPosition?(end-c.openPosition.entryTimestamp)/60000:0;
  if(!near(c.heldMinutes,minutes+openMinutes)||!nullableNear(c.meanClosedHoldingMinutes,c.closedTrades?minutes/c.closedTrades:null)||!near(c.capitalTimeUtilizationPercent,100*c.heldMinutes/43200)||c.peakConcurrentPositions!==(l.entries.length?1:0))throw new Error('Evolution capital-time mismatch');
  if(c.openPosition===null&&(!near(c.realizedPnlUsdt,c.netReturnUsdt)||!near(sum(l.closedTradeLedger.map(t=>t.feesUsdt)),c.feesUsdt)))throw new Error('Evolution flat-wallet reconciliation mismatch');
 }
 const candidates=screenEvolution(r.runs),eligible=candidates.filter(c=>c.eligibleForFutureIndependentProtocol).map(c=>c.name);
 return {protocol:policy.protocol,status:eligible.length?'blocked_independent_and_operational_prerequisites':'blocked_no_eligible_candidate',evidence:{reportFileSha256:sha(reportText),ledgerFileSha256:sha(ledgerText),experimentFileSha256:sha(experimentText),developmentDatasetSha256:r.datasetSha256},matrixCases:26,candidates,eligibleForFutureIndependentProtocol:eligible,
  blockers:[...(eligible.length?[]:['no_eligible_development_candidate']),'independent_validation_not_performed','hybrid_native_demo_entry_exit_protection_and_reconciliation_not_validated','current_account_balance_minimum_notional_access_and_maker_fee_unconfirmed','kill_switch_and_risk_limits_require_validation_in_native_hybrid_adapter'],
  independentDataCollected:false,holdoutExecuted:false,demoIntegrationApproved:false,nativeDemoAdapterExecuted:false,configurationPromoted:false,realMoneyApproved:false,ordersSent:0,paidAiCalls:false,
  paper48h:{classification:'experimental_observation_not_financial_approval',automaticRestart:false,updateRunningCommit:false,automaticNewSession:false,completionEvidence:'completed checkpoint, full coverage and reconciled ledger required; logs alone do not audit the volume',knownInterruption:'prior missing-confirmed-candle failure/recovery; not certified as uninterrupted',afterCompletion:'archive checkpoint/coverage and audit copied files; do not rerun rejected candidates'},
  nextVersion:{separateSessionDirectoryRequired:true,oldCheckpointMigrationApproved:false,freezeBeforeIndependentData:['code','strategy','costs','universe','risk','criteria'],nativeDemoWorkConditionalOnEconomicEligibility:true},
  limitations:['Hashes bind archived bytes; they do not authenticate exchange fills or prove real profitability.','Reconciles modeled cash/fees, trade identity, single-position timeline, metrics, mode/block closed PnL and capital time. Does not rebuild candles, intra-block marks or maximum drawdown path. Those remain bound to prior replay reproduction.','Positive synthetic inputs only permit considering a future independent protocol. They never authorize execution or funds.','Account quotes and Paper observations do not certify native Demo fills, balances, minimum notional or live protection. No account requery is performed.','This deterministic report contains no claim about current live health or actual 48h completion; operational observations must be separately timestamped.']};
}
