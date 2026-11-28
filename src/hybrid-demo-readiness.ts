import { createHash } from 'node:crypto';
import { z } from 'zod';
import { hybridPlanSchema } from './hybrid-research-signals.js';
import { semanticHash } from './cost-experiments.js';

export const hybridDemoReadinessPlanSchema=z.object({
 protocol:z.literal('hybrid-demo-readiness-v1'),
 developmentReportFileSha256:z.string().regex(/^[a-f0-9]{64}$/),
 developmentDatasetSha256:z.string().regex(/^[a-f0-9]{64}$/),
 strategyPlanSha256:z.string().regex(/^[a-f0-9]{64}$/),
 costScenarios:z.tuple([z.literal('account-conditioned'),z.literal('account-cost-stress')]),
 minimumClosedTradesPerCase:z.literal(30),
 policyPurpose:z.literal('conservative_triage_not_independent_validation'),
}).strict();
const block=z.object({name:z.enum(['D1-D10','D11-D20','D21-D30']),complete:z.literal(true),candles:z.literal(960),netReturnUsdt:z.number().finite(),profitFactor:z.number().finite().nonnegative().nullable()});
const row=z.object({variant:z.enum(['baseline','trend_pullback','mean_reversion','hybrid']),scenario:z.string(),closedTrades:z.number().int().nonnegative(),netReturnUsdt:z.number().finite(),realizedPnlUsdt:z.number().finite(),profitFactor:z.number().finite().nonnegative().nullable(),expectancyUsdt:z.number().finite().nullable(),blocks:z.array(block).length(3)});
const reportSchema=z.object({protocolSha256:z.string(),datasetSha256:z.string(),runs:z.array(row)});

/** Readiness only. Never imports an executor, account client, scheduler or deployment tool. */
export function assessHybridDemoReadiness(reportText:string,rawStrategyPlan:unknown,rawReadinessPlan:unknown){
 const policy=hybridDemoReadinessPlanSchema.parse(rawReadinessPlan),strategy=hybridPlanSchema.parse(rawStrategyPlan);
 const reportFileSha256=createHash('sha256').update(reportText).digest('hex');
 if(reportFileSha256!==policy.developmentReportFileSha256||semanticHash(strategy)!==policy.strategyPlanSha256)throw new Error('Frozen hybrid readiness evidence identity mismatch');
 const report=reportSchema.parse(JSON.parse(reportText));
 if(report.protocolSha256!==policy.strategyPlanSha256||report.datasetSha256!==policy.developmentDatasetSha256)throw new Error('Hybrid protocol/dataset mismatch');
 const accountRuns=report.runs.filter(r=>policy.costScenarios.some(s=>s===r.scenario));
 if(accountRuns.length!==8||new Set(accountRuns.map(r=>r.variant+'/'+r.scenario)).size!==8)throw new Error('Complete unique account-cost comparison matrix required');
 for(const r of accountRuns){
  if(new Set(r.blocks.map(b=>b.name)).size!==3||Math.abs(r.blocks.reduce((s,b)=>s+b.netReturnUsdt,0)-r.netReturnUsdt)>1e-8)throw new Error('Hybrid blocks do not reconcile');
  if(r.closedTrades===0?(r.expectancyUsdt!==null||r.profitFactor!==null):(r.expectancyUsdt===null||Math.abs(r.expectancyUsdt*r.closedTrades-r.realizedPnlUsdt)>1e-8))throw new Error('Hybrid expectancy/count mismatch');
 }
 const candidates=(['trend_pullback','mean_reversion','hybrid'] as const).map(variant=>{
  const cases=accountRuns.filter(r=>r.variant===variant);
  const sufficientSample=cases.every(r=>r.closedTrades>=policy.minimumClosedTradesPerCase);
  const positiveAfterCosts=cases.every(r=>r.netReturnUsdt>0&&r.expectancyUsdt!==null&&r.expectancyUsdt>0&&r.profitFactor!==null&&r.profitFactor>1);
  const positiveBlocks=cases.every(r=>r.blocks.every(b=>b.netReturnUsdt>0&&b.profitFactor!==null&&b.profitFactor>1));
  return {variant,sufficientSample,positiveAfterCosts,positiveBlocks,preliminaryEligible:sufficientSample&&positiveAfterCosts&&positiveBlocks,cases:cases.map(r=>({scenario:r.scenario,closedTrades:r.closedTrades,netReturnUsdt:r.netReturnUsdt,profitFactor:r.profitFactor,expectancyUsdt:r.expectancyUsdt}))};
 });
 const preliminaryEligibleVariants=candidates.filter(c=>c.preliminaryEligible).map(c=>c.variant);
 const blockers=[...(preliminaryEligibleVariants.length?[]:['no_eligible_development_candidate']),
  'independent_validation_not_performed',
  'hybrid_operational_entry_and_exit_adapter_not_validated',
  'strategy_mode_and_trailing_time_stop_state_restart_not_validated',
  'intended_account_fees_minima_spendable_balance_and_access_unconfirmed',
  '17_usdt_10_usdt_lot_runtime_risk_compatibility_unverified',
  'hybrid_native_protection_tick_precision_and_reconciliation_not_validated',
  'candidate_configuration_commit_and_demo_deployment_not_frozen'];
 return {protocol:policy.protocol,status:preliminaryEligibleVariants.length?'blocked_operational_and_independent_prerequisites':'blocked_no_eligible_candidate',
  developmentReportFileSha256:reportFileSha256,developmentDatasetSha256:report.datasetSha256,strategyPlanSha256:semanticHash(strategy),costScenarios:policy.costScenarios,
  paidAiRequired:false,paidAiCalls:false,accountCostsConfirmed:false,preliminaryEligibleVariants,candidates,blockers,
  intendedBankUsdt:strategy.bankUsdt,maximumLotUsdt:strategy.lotUsdt,initialNotionalExposurePercent:100*strategy.lotUsdt/strategy.bankUsdt,
  demo48hStarted:false,operationalIntegrationCompleted:false,configurationPromoted:false,realMoneyApproved:false,
  future48hProtocol:{durationHours:48,clockStarts:'after_confirmed_frozen_demo_deployment_and_reconciliation',
   record:['commit/configuration hash','account environment and allocation','signals and rejections by mode','orders/fills/fees','native protection coverage','restart/reconciliation events','net marked and realized P&L','peak exposure and risk halts'],
   stopOn:['unprotected or unreconciled position','unexpected account/environment','duplicate or unknown order','unavailable balance/terms evidence','frozen risk limit exceeded'],
   lowTradeCount:'extend or mark inconclusive; never manufacture trades',profitabilityCertification:false,automaticRealMoneyApproval:false},
  limitations:['This is a reproducible readiness assessment, not implementation or execution of the hybrid Demo strategy.',
   'The 30-trade and all-blocks-positive rules are conservative triage for future selection, not a claim of predeclared independent validation of already consulted data.',
   'Flags in historical JSON cannot approve deployment. Even favorable synthetic economics leave operational and independent prerequisites blocked.',
   'No risk limit is increased to admit a 10-USDT lot against 17 USDT. Current limits and actual fees must be reconciled first.']};
}
