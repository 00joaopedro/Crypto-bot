import { hybridFeatures,hybridSignalChecks,type HybridMode } from './hybrid-research-signals.js';
import { assessMarketQuality } from './signal-ranking.js';
import { scanHybridResearch,replayHybridDecisions,type HybridAdmissionEvent } from './hybrid-research-replay.js';
import { advanceShadowSession,type ShadowConfiguration,type ShadowSnapshot } from './hybrid-shadow-session.js';
import { semanticHash } from './cost-experiments.js';
/** Reproduce a supplied checkpoint before explaining it. No account access or exchange orders. */
export function auditShadowSession(config:ShadowConfiguration,state:ShadowSnapshot){
 // This checks the stored identity and reproduces the ledger with THIS analysis code; it does not authenticate the old deployed binary.
 advanceShadowSession(config,state,state.data,state.codeFingerprint,Math.max(Date.now(),Date.parse(state.startedAtUtc)));
 const funnel:Array<{symbol:string;strategy_mode:HybridMode;candles:number;passed:Record<string,number>;sequentialPassed:Record<string,number>;signals:number}>=[];
 for(const d of state.data.instruments){
  for(const mode of ['TREND_PULLBACK','MEAN_REVERSION'] as const){
   const row={symbol:d.symbol,strategy_mode:mode,candles:0,passed:{} as Record<string,number>,sequentialPassed:{} as Record<string,number>,signals:0};
   // Only decisions with a following execution candle. Last closed signal is explicitly pending, not an admission rejection.
   for(let i=config.strategy.warmup15m;i<d.candles15m.length-1;i++){
    row.candles++;const history=d.candles15m.slice(0,i+1),f=hybridFeatures(history,d.candles1h);
    const checks={features:f!==null,market_quality:assessMarketQuality(history.slice(-100)).score>=3,...(f?hybridSignalChecks(f)[mode]:{})};let surviving=true;
    for(const [key,passed]of Object.entries(checks)){row.passed[key]=(row.passed[key]??0)+Number(passed);surviving&&=passed;row.sequentialPassed[key]=(row.sequentialPassed[key]??0)+Number(surviving);}
    if(surviving)row.signals++;
   }funnel.push(row);
  }
 }
 const events:HybridAdmissionEvent[]=[],decisions=state.result?scanHybridResearch(state.data.instruments,config.strategy,config.profile.variant,config.reference.parameters):null;
 const result=decisions?replayHybridDecisions(state.data.instruments,decisions,config.strategy,config.scenario,config.reference.parameters,config.strategy.warmup15m,config.profile.riskLimits,e=>events.push(e)):null;
 if(semanticHash(result)!==state.resultSha256)throw new Error('Diagnostic replay differs from checkpoint');
 const admissions=Object.values(events.reduce<Record<string,{symbol:string;strategy_mode:string;outcome:string;reason:string;count:number}>>((all,e)=>{const key=JSON.stringify([e.symbol,e.strategy_mode,e.outcome,e.reason]);const r=all[key]??={symbol:e.symbol,strategy_mode:e.strategy_mode,outcome:e.outcome,reason:e.reason,count:0};r.count++;return all;},{}));
 const ledger=(result?.closedTradeLedger??[]).map(t=>{
  const bars=state.data.instruments.find(d=>d.symbol===t.symbol)!.candles15m.filter(c=>c.timestamp>=t.entryTimestamp&&c.timestamp<t.exitTimestamp);
  return {...t,netBeforeChargedFeesUsdt:t.netPnlUsdt+t.feesUsdt,costSource:'paper_modeled_not_actual_fills',embeddedSpreadSlippageIncluded:true,
   excursion:{candles:bars.length,mfeRate:bars.length?Math.max(0,...bars.map(c=>c.high/t.entryPrice-1)):null,maeRate:bars.length?Math.min(0,...bars.map(c=>c.low/t.entryPrice-1)):null,exitCandleExcluded:true}};
 });
 return {protocol:'hybrid-shadow-diagnostics-v1',checkpointSha256:state.checkpointSha256,storedCodeFingerprint:state.codeFingerprint,configurationHash:state.configurationHash,asOfUtc:state.data.asOfUtc,status:state.status,
  costModel:{source:'modeled',scenario:config.scenario},
  balance:{initialUsdt:config.strategy.bankUsdt,finalEquityUsdt:result?.finalEquityUsdt??config.strategy.bankUsdt,netReturnUsdt:result?.netReturnUsdt??0,realizedPnlUsdt:result?.realizedPnlUsdt??0,totalModeledFeesUsdt:result?.feesUsdt??0},
  funnel,admissions,ledger,metrics:result,ordersSent:0,realMoneyApproved:false,
  limitations:['Independent filter passes overlap; sequential counts use the listed order. Counts are per pair/mode/candle, not distinct trades.',
   'Last closed candle has no next execution candle yet and is excluded from the admission funnel. Mode selection follows the profile variant.',
   'Before-charged-fees accounting retains modeled spread/slippage; it is not a no-cost counterfactual. Actual fees and actual slippage are unavailable.',
   'No live rejection stream was recorded by old code. This is deterministic reconstruction from checkpoint candles, not proof of uninterrupted observation or executable fills.',
   'MFE/MAE exclude the entire exit candle because intrabar order is unknown; same-candle exits are unknown, not zero. Excursions are price observations, not attainable P&L. Decomposed slippage amounts are not observed.']};
}
