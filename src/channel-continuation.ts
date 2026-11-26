import { emaSeries, averageTrueRange } from './indicators.js';
import { aggregateFourHours, horizonFeatures } from './trend-horizon.js';
import { hybridDecisions, type HybridDecision } from './hybrid-research-signals.js';
import { assessMarketQuality } from './signal-ranking.js';
import { replayHybridDecisions, type HybridInstrument } from './hybrid-research-replay.js';
import { shadowConfiguration } from './hybrid-shadow-session.js';
import { semanticHash } from './cost-experiments.js';
import type { Candle } from './types.js';
export const CHANNEL_CORE = ['BTC/USDT','ETH/USDT','SOL/USDT'] as const;

/** Caller passes only completed UTC4h bars. No Bollinger/RSI/compression/pullback requirement. */
export function channelChecks(closed: Candle[]){
 if(closed.length<250)return null;
 const current=closed.at(-1)!,previous=closed.slice(-21,-1),closes=closed.map(c=>c.close),fast=emaSeries(closes,50),slow=emaSeries(closes,200);
 const atr=averageTrueRange(closed,14),upper=Math.max(...previous.map(c=>c.high));
 return {atr,upper,checks:{trend:fast.at(-1)!>slow.at(-1)!&&fast.at(-1)!>fast.at(-2)!,breakout:current.close>upper,green:current.close>current.open,atr_valid:Number.isFinite(atr)&&atr>0}};
}

export function scanChannelContinuation(hours:Candle[]){
 const four=aggregateFourHours(hours),rows:HybridDecision[][]=Array.from({length:hours.length},()=>[]);
 const funnel={closed4hDecisions:0,rawSignals:0,transitions:0,qualityPasses:0,signals:0,independentPasses:{trend:0,breakout:0,green:0,atr_valid:0}};
 let previous=false;
 for(let i=999;i<hours.length-1;i++){
  const c=hours[i]!;
  if((c.timestamp+3600000)%14400000)continue;
  const closed=four.filter(b=>b.timestamp+14400000<=c.timestamp+3600000),f=channelChecks(closed);if(!f)throw new Error('Insufficient closed4h warmup');
  const current=Object.values(f.checks).every(Boolean),transition=current&&!previous;previous=current;
  if(i<1000)continue;
  funnel.closed4hDecisions++;for(const k of Object.keys(f.checks) as Array<keyof typeof f.checks>)funnel.independentPasses[k]+=Number(f.checks[k]);
  funnel.rawSignals+=Number(current);funnel.transitions+=Number(transition);
  const quality=assessMarketQuality(hours.slice(Math.max(0,i-99),i+1)).score>=3;funnel.qualityPasses+=Number(quality);
  if(transition&&quality){rows[i]=[{strategy_mode:'CHANNEL_BREAKOUT',decisionTimestamp:c.timestamp,atr:f.atr,pullbackLow:closed.at(-1)!.low,sma20:c.close}];funnel.signals++;}
 }
 return {rows,funnel};
}

/** Criteria are frozen in code/protocol, not lowered after an insufficient or losing sample. */
export function screenChannelRuns(runs:Array<ReturnType<typeof replayHybridDecisions>&{name:string;scenario:string}>){
 const candidates=runs.filter(r=>r.name==='CHANNEL_4H');
 const checks=candidates.map(r=>({scenario:r.scenario,sample:r.closedTrades>=30,pf:r.profitFactor!==null&&r.profitFactor>1.25,ev:r.expectancyUsdt!==null&&r.expectancyUsdt>0,net:r.netReturnUsdt>0,blocks:r.blocks.length===3&&r.blocks.every(b=>b.complete&&b.netReturnUsdt>0),drawdown:r.maxDrawdownPercent<10,withoutTop3:r.realizedPnlWithoutTop3Usdt>0}));
 return {checks,eligible:checks.length===2&&new Set(checks.map(c=>c.scenario)).size===2&&checks.every(c=>['account-conditioned','account-cost-stress'].includes(c.scenario)&&c.sample&&c.pf&&c.ev&&c.net&&c.blocks&&c.drawdown&&c.withoutTop3)};
}

export function runChannelContinuation(data:{instruments:HybridInstrument[];source:unknown},protocol:any,rawPlan:unknown,rawReference:unknown,rawProfile:unknown,scenarios:ReturnType<typeof shadowConfiguration>['reference']['scenarios']){
 const config=shadowConfiguration(rawProfile,rawPlan,rawReference),start=Date.parse(protocol.window.evaluationStartUtc),end=Date.parse(protocol.window.endExclusiveUtc);
 if(protocol.protocol!=='channel-continuation-development-v1'||semanticHash(data)!==protocol.sourceDatasetSha256||JSON.stringify(protocol.universe)!==JSON.stringify(CHANNEL_CORE)||end-start!==90*86400000||protocol.window.warmupHours!==1000||semanticHash(protocol.riskLimits)!==semanticHash(config.profile.riskLimits))throw new Error('Frozen channel identity/window mismatch');
 const selected=CHANNEL_CORE.map(symbol=>{const found=data.instruments.filter(d=>d.symbol===symbol);if(found.length!==1)throw new Error('Missing/duplicate core instrument');return found[0]!;});
 const channelMaps=new Map<string,HybridDecision[][]>(),referenceMaps=new Map<string,HybridDecision[][]>(),funnel=[];
 for(const d of selected){
  if(d.candles15m.length!==3160||d.candles15m[0]!.timestamp!==start-1000*3600000||d.candles15m.at(-1)!.timestamp!==end-3600000)throw new Error('Incomplete frozen1h history');
  const {rows,funnel:counts}=scanChannelContinuation(d.candles15m);channelMaps.set(d.symbol,rows);funnel.push({symbol:d.symbol,...counts});
  const four=aggregateFourHours(d.candles15m),reference:HybridDecision[][]=Array.from({length:d.candles15m.length},()=>[]);let previous=false;
  for(let i=999;i<d.candles15m.length-1;i++){
   const history=d.candles15m.slice(0,i+1),f=horizonFeatures(history,four);if(!f)throw new Error('Missing reference warmup');
   const signals=assessMarketQuality(history.slice(-100)).score>=3?hybridDecisions(f).filter(s=>s.strategy_mode==='TREND_PULLBACK'):[],current=signals.length>0;
   if(i>=1000&&current&&!previous)reference[i]=signals;previous=current;
  }referenceMaps.set(d.symbol,reference);
 }
 const runs=[];
 for(const name of ['HORIZON_ATR_CORE','CHANNEL_4H'] as const)for(const scenario of scenarios){
  const admissions:unknown[]=[];
  const result=replayHybridDecisions(selected,name==='CHANNEL_4H'?channelMaps:referenceMaps,config.strategy,scenario,config.reference.parameters,1000,config.profile.riskLimits,e=>admissions.push(e),undefined,name==='CHANNEL_4H'?'channel':'horizon',3600000);
  runs.push({name,scenario:scenario.name,...result,admissions});
 }
 const {checks,eligible}=screenChannelRuns(runs);
 return {protocol:protocol.protocol,sourceDatasetSha256:semanticHash(data),selectedDatasetSha256:semanticHash(selected),universe:CHANNEL_CORE,window:protocol.window,signalTimeframe:'4h',executionTimeframe:'1h',bankUsdt:17,lotCeilingUsdt:10,riskLimits:config.profile.riskLimits,funnel,runs,checks,
  status:eligible?'development_screen_passed_external_prerequisites_pending':'blocked_no_eligible_candidate',eligibleForFutureIndependentProtocol:eligible,
  blockers:[...(!eligible?['no_eligible_development_candidate']:[]),'current_account_costs_cash_rules_and_book_not_confirmed','independent_consulted_window_registry_not_certified','independent_validation_not_executed','native_hybrid_execution_not_validated'],
  independentReservation:protocol.independentReservation,independentDataCollected:false,holdoutExecuted:false,demoIntegrationApproved:false,configurationPromoted:false,realMoneyApproved:false,ordersSent:0,paidAiCalls:false};
}
