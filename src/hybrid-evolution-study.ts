import { isDeepStrictEqual } from 'node:util';
import { shadowDataSchema,shadowConfiguration } from './hybrid-shadow-session.js';
import { hybridFeatures,hybridDecisions,type HybridDecision } from './hybrid-research-signals.js';
import { replayHybridDecisions,validateHybridInputs,type HybridAdmissionEvent } from './hybrid-research-replay.js';
import { closedHourRegime,squeezeDecision,type EvolutionReplay } from './hybrid-evolution-options.js';
import { assessMarketQuality } from './signal-ranking.js';
import { semanticHash } from './cost-experiments.js';

export const EVOLUTION_CASES=[['A_REFERENCE','trend_pullback','reference'],['B_REFERENCE','mean_reversion','reference'],['AB_REFERENCE','hybrid','reference'],['A_TRANSITION','trend_pullback','transition'],['B_TRANSITION','mean_reversion','transition'],['A_REGIME','trend_pullback','regime'],['B_REGIME','mean_reversion','regime'],['A_ROI','trend_pullback','roi'],['B_ROI','mean_reversion','roi'],['A_FULL','trend_pullback','full'],['B_FULL','mean_reversion','full'],['AB_FULL','hybrid','full'],['C_SQUEEZE','squeeze','squeeze']] as const;
export function transitionDecisions(current:readonly HybridDecision[],previous:readonly HybridDecision[]){
 return current.filter(c=>!previous.some(p=>p.strategy_mode===c.strategy_mode));
}
type ScreenRun={name:string;scenario:string;closedTrades:number;expectancyUsdt:number|null;profitFactor:number|null;netReturnUsdt:number;maxDrawdownPercent:number;realizedPnlWithoutTop3Usdt:number;blocks:Array<{complete:boolean;netReturnUsdt:number}>};
export function screenEvolution(runs:ScreenRun[]){
 const selection=EVOLUTION_CASES.filter(c=>c[2]!=='reference').map(([name])=>{
  const cases=runs.filter(r=>r.name===name),checks=cases.map(r=>({scenario:r.scenario,sample:Number.isSafeInteger(r.closedTrades)&&r.closedTrades>=30,ev:r.expectancyUsdt!==null&&Number.isFinite(r.expectancyUsdt)&&r.expectancyUsdt>0,pf:r.profitFactor!==null&&Number.isFinite(r.profitFactor)&&r.profitFactor>1.25,net:Number.isFinite(r.netReturnUsdt)&&r.netReturnUsdt>0,drawdown:Number.isFinite(r.maxDrawdownPercent)&&r.maxDrawdownPercent>=0&&r.maxDrawdownPercent<10,withoutTop3:Number.isFinite(r.realizedPnlWithoutTop3Usdt)&&r.realizedPnlWithoutTop3Usdt>0,blocks:r.blocks.length===3&&r.blocks.every(b=>b.complete&&Number.isFinite(b.netReturnUsdt)&&b.netReturnUsdt>0)}));
  return {name,checks,eligibleForFutureIndependentProtocol:cases.length===2&&new Set(cases.map(c=>c.scenario)).size===2&&cases.every(c=>['account-conditioned','account-cost-stress'].includes(c.scenario))&&checks.every(c=>c.sample&&c.ev&&c.pf&&c.net&&c.drawdown&&c.withoutTop3&&c.blocks)};
 });
 const combined=selection.find(s=>s.name==='AB_FULL')!;
 combined.eligibleForFutureIndependentProtocol &&= selection.find(s=>s.name==='A_FULL')!.eligibleForFutureIndependentProtocol&&selection.find(s=>s.name==='B_FULL')!.eligibleForFutureIndependentProtocol;
 return selection;
}
/** Pure offline study. Does not import exchange clients, runtime configuration or order executors. */
export function runHybridEvolution(rawData:unknown,rawPlan:unknown,rawReference:unknown,rawProfile:unknown,archived:{runs:any[]},protocol:any){
 if(semanticHash(protocol)!=='59810576f1135cba48d90981db2d9b55922ef07311d938f9eecd6a3273c43352')throw new Error('Frozen evolution protocol identity mismatch');
 const config=shadowConfiguration(rawProfile,rawPlan,rawReference),data=shadowDataSchema.parse(rawData);
 if(semanticHash(data)!=='fb88541a351e706edcc838fffdd42ed9a11ba25ace8d4a883d8090ed6eaadfc4'||semanticHash(config.strategy)!=='8af5316ef7b6774f4c66c2d3a4fcc792abd2ed34a77b41fa9a1c35eaf876fce9')throw new Error('Frozen development identity mismatch');
 if(!isDeepStrictEqual(config.profile.riskLimits,{riskPerTrade:.01,maxExposure:.25,maxAltExposure:.1,maxSymbolExposure:.15})||!isDeepStrictEqual(protocol.cases,EVOLUTION_CASES.map(([name,variant,change])=>({name,variant,change}))))throw new Error('Frozen evolution matrix/risk changed');
 if(Date.parse(data.asOfUtc)>Date.now())throw new Error('Future data');
 validateHybridInputs(data.instruments,config.strategy);
 const maps=new Map(EVOLUTION_CASES.map(([name])=>[name,new Map<string,HybridDecision[][]>()]));
 const funnel=Object.fromEntries(EVOLUTION_CASES.map(([name])=>[name,{evaluatedCandles:0,rawSignals:0,afterRegime:0,transitionRejected:0,emittedSignals:0}]));
 for(const d of data.instruments){
  for(const [name]of EVOLUTION_CASES)maps.get(name)!.set(d.symbol,Array.from({length:d.candles15m.length},()=>[]));
  const previous=new Map<string,HybridDecision[]>();
  // Include t-1 in warmup so transition cannot manufacture an edge at evaluation start.
  for(let i=config.strategy.warmup15m-1;i<d.candles15m.length-1;i++){
   const history=d.candles15m.slice(0,i+1),f=hybridFeatures(history,d.candles1h);
   if(!f)throw new Error('Features missing after warmup');
   const quality=assessMarketQuality(history.slice(-100)).score>=3,base=quality?hybridDecisions(f):[],regime=closedHourRegime(d.candles1h,f.current.timestamp+900000);
   for(const [name,variant,change]of EVOLUTION_CASES){
    const raw=change==='squeeze'?(quality?squeezeDecision(history,f,regime):[]):base.filter(s=>variant==='hybrid'||s.strategy_mode===(variant==='trend_pullback'?'TREND_PULLBACK':'MEAN_REVERSION'));
    const filtered=change==='regime'||change==='full'?raw.filter(s=>s.strategy_mode==='TREND_PULLBACK'?regime.trend:regime.lateral):raw;
    const edge=change==='transition'||change==='full'||change==='squeeze',emitted=edge?transitionDecisions(filtered,previous.get(name)??[]):filtered;
    previous.set(name,filtered);
    if(i<config.strategy.warmup15m)continue;
    const count=funnel[name]!;count.evaluatedCandles++;count.rawSignals+=raw.length;count.afterRegime+=filtered.length;count.transitionRejected+=filtered.length-emitted.length;count.emittedSignals+=emitted.length;
    maps.get(name)!.get(d.symbol)![i]=emitted;
   }
  }
 }
 const scenarios=config.reference.scenarios.map(s=>({...s,symbolCosts:Object.fromEntries(config.strategy.watchlist.map(symbol=>[symbol,s.symbolCosts?.[symbol]??{feeRate:s.feeRate,slippageRate:s.slippageRate,spreadRate:s.spreadRate,entryFeeCurrency:'base' as const}]))}));
 if(scenarios.length!==2||scenarios.map(s=>s.name).sort().join()!=='account-conditioned,account-cost-stress')throw new Error('Frozen cost cases required');
 const runs=[];let referencesReproduced=0;
 for(const [name,variant,change]of EVOLUTION_CASES)for(const scenario of scenarios){
  const admissions:HybridAdmissionEvent[]=[],option:EvolutionReplay|undefined=['roi','full','squeeze'].includes(change)?change as EvolutionReplay:undefined;
  const result=replayHybridDecisions(data.instruments,maps.get(name)!,config.strategy,scenario,config.reference.parameters,config.strategy.warmup15m,config.profile.riskLimits,e=>admissions.push(e),undefined,option);
  if(name==='A_REFERENCE'||name==='B_REFERENCE'){
   const expected=archived.runs.find(r=>r.name===name&&r.scenario===scenario.name);
   const {entries,closedTradeLedger,...metrics}=result;
   if(!expected)throw new Error('Archived reference absent');
   for(const [key,value]of Object.entries({...metrics,entries,closedTradeLedger,admissions}))if(!isDeepStrictEqual(value,expected[key]))throw new Error('Archived risk-sized reference changed: '+key);
   referencesReproduced++;
  }
  const closedMinutes=result.closedTradeLedger.reduce((s,t)=>s+t.holdingCandles*15,0),openMinutes=result.openPosition?(Date.parse(data.asOfUtc)-result.openPosition.entryTimestamp)/60000:0;
  runs.push({name,variant,change,scenario:scenario.name,...result,admissions,heldMinutes:closedMinutes+openMinutes,meanClosedHoldingMinutes:result.closedTrades?closedMinutes/result.closedTrades:null,capitalTimeUtilizationPercent:100*(closedMinutes+openMinutes)/(30*24*60)});
 }
 const selection=screenEvolution(runs);
 return {protocol:'hybrid-evolution-development-v1',datasetSha256:semanticHash(data),asOfUtc:data.asOfUtc,includedSymbols:data.instruments.map(d=>d.symbol),bankUsdt:17,lotCeilingUsdt:10,riskLimits:config.profile.riskLimits,scenarios,referencesReproduced,funnel,runs,selection,status:selection.some(s=>s.eligibleForFutureIndependentProtocol)?'development_screen_passed_not_validated':'blocked_no_eligible_candidate',independentDataCollected:false,demoIntegrationApproved:false,configurationPromoted:false,realMoneyApproved:false,ordersSent:0,paidAiCalls:false};
}
