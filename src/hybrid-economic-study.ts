import { screenEconomicCandidates } from './hybrid-economic-screen.js';
import { isDeepStrictEqual } from 'node:util';
import { shadowDataSchema,shadowConfiguration } from './hybrid-shadow-session.js';
import { hybridFeatures,hybridSignalChecks,type HybridDecision } from './hybrid-research-signals.js';
import { hybridEconomicDecisions,netRewardRisk,type HybridEconomicHypothesis } from './hybrid-economic-options.js';
import { assessMarketQuality } from './signal-ranking.js';
import { semanticHash } from './cost-experiments.js';
import { replayHybridDecisions,validateHybridInputs,type HybridAdmissionEvent,type HybridVariant } from './hybrid-research-replay.js';
import { comparisonSlippage } from './strategy-comparison.js';
export const ECONOMIC_CASES=[['A_REFERENCE','trend_pullback',undefined],['A_VOLUME_OFF','trend_pullback','A_VOLUME_OFF'],['A_TOUCH_1_ATR','trend_pullback','A_TOUCH_1_ATR'],['B_REFERENCE','mean_reversion',undefined],['B_NET_RR_1_5','mean_reversion','B_NET_RR_1_5'],['B_ATR_OFF','mean_reversion','B_ATR_OFF']] as const;
export function runHybridEconomicStudy(rawData:unknown,rawPlan:unknown,rawReference:unknown,rawProfile:unknown,legacy:{runs:any[]}){
 const config=shadowConfiguration(rawProfile,rawPlan,rawReference),data=shadowDataSchema.parse(rawData);
 if(semanticHash(data)!=='fb88541a351e706edcc838fffdd42ed9a11ba25ace8d4a883d8090ed6eaadfc4')throw new Error('Frozen development dataset identity mismatch');
 if(Date.parse(data.asOfUtc)>Date.now())throw new Error('Future dataset not allowed');
 validateHybridInputs(data.instruments,config.strategy);
 if(semanticHash(config.strategy)!=='8af5316ef7b6774f4c66c2d3a4fcc792abd2ed34a77b41fa9a1c35eaf876fce9'||!isDeepStrictEqual(config.profile.riskLimits,{riskPerTrade:.01,maxExposure:.25,maxAltExposure:.1,maxSymbolExposure:.15}))throw new Error('Frozen strategy or risk limits changed');
 if(config.reference.scenarios.length!==2||!config.reference.scenarios.some(s=>s.name==='account-conditioned')||!config.reference.scenarios.some(s=>s.name==='account-cost-stress'))throw new Error('Frozen cost cases required');
 const maps=new Map<string,Map<string,HybridDecision[][]>>(ECONOMIC_CASES.map(c=>[c[0],new Map()]));
 const funnel:Record<string,{candles:number;passed:Record<string,number>;sequential:Record<string,number>;without:Record<string,number>;signals:number}>={};
 for(const d of data.instruments){
  for(const c of ECONOMIC_CASES)maps.get(c[0])!.set(d.symbol,Array.from({length:d.candles15m.length},()=>[]));
  for(let i=config.strategy.warmup15m;i<d.candles15m.length-1;i++){
   const history=d.candles15m.slice(0,i+1),f=hybridFeatures(history,d.candles1h),quality=assessMarketQuality(history.slice(-100)).score>=3;
   if(!f)throw new Error('Features missing after frozen warmup');
   for(const mode of ['TREND_PULLBACK','MEAN_REVERSION']as const){
    const row=funnel[mode]??={candles:0,passed:{},sequential:{},without:{},signals:0};row.candles++;
    const checks={quality,...hybridSignalChecks(f)[mode]};let seq=true;
    for(const [k,v]of Object.entries(checks)){row.passed[k]=(row.passed[k]??0)+Number(v);seq&&=v;row.sequential[k]=(row.sequential[k]??0)+Number(seq);row.without[k]=(row.without[k]??0)+Number(Object.entries(checks).every(([other,b])=>other===k||b));}
    row.signals+=Number(Object.values(checks).every(Boolean));
   }
   if(quality)for(const [name,variant,hypothesis]of ECONOMIC_CASES)maps.get(name)!.get(d.symbol)![i]=hybridEconomicDecisions(f,hypothesis).filter(s=>s.strategy_mode===(variant==='trend_pullback'?'TREND_PULLBACK':'MEAN_REVERSION'));
  }
 }
 const scenarios=config.reference.scenarios.map(s=>({...s,symbolCosts:Object.fromEntries(config.strategy.watchlist.map(symbol=>[symbol,s.symbolCosts?.[symbol]??{feeRate:s.feeRate,slippageRate:s.slippageRate,spreadRate:s.spreadRate,entryFeeCurrency:'base' as const}]))}));
 let reproduced=0;
 for(const [name,variant]of ECONOMIC_CASES.filter(c=>c[2]===undefined))for(const scenario of scenarios){
  const r=replayHybridDecisions(data.instruments,maps.get(name)!,config.strategy,scenario,config.reference.parameters,config.strategy.warmup15m);
  const {entries,closedTradeLedger,...metrics}=r,expected=legacy.runs.find(r=>r.variant===variant&&r.scenario===scenario.name);
  if(!expected)throw new Error('Archived baseline missing');const {variant:v,scenario:s,...old}=expected;
  if(!isDeepStrictEqual(metrics,old))throw new Error('Archived fixed-lot reference differs');reproduced++;
 }
 const runs:Array<ReturnType<typeof replayHybridDecisions>&{name:string;variant:HybridVariant;hypothesis:HybridEconomicHypothesis|null;scenario:string;meanHoldingMinutes:number|null;heldMinutes:number;admissions:HybridAdmissionEvent[]}>=[];
 for(const [name,variant,hypothesis]of ECONOMIC_CASES)for(const scenario of scenarios){
  const admissions:HybridAdmissionEvent[]=[];
  const r=replayHybridDecisions(data.instruments,maps.get(name)!,config.strategy,scenario,config.reference.parameters,config.strategy.warmup15m,config.profile.riskLimits,e=>admissions.push(e),hypothesis);
  const {entries,closedTradeLedger,...metrics}=r;
  const durations=closedTradeLedger.map(t=>t.holdingCandles*15);
  runs.push({name,variant,hypothesis:hypothesis??null,scenario:scenario.name,...metrics,meanHoldingMinutes:durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null,heldMinutes:durations.reduce((a,b)=>a+b,0),entries,closedTradeLedger,admissions});
 }
 const selection=screenEconomicCandidates(runs);
 const staticFeasibility=scenarios.map(s=>{const slip=comparisonSlippage(s),quantity=1-s.feeRate;const loss=1-quantity*.988*(1-s.feeRate)*(1-slip);return {scenario:s.name,maximumBNetTargetRate:.014,estimatedStopLossRate:loss,maximumNetRewardRisk:.014/loss,rr15Possible:.014/loss>=1.5};});
 return {protocol:'hybrid-economic-development-v1',datasetSha256:semanticHash(data),asOfUtc:data.asOfUtc,includedSymbols:data.instruments.map(d=>d.symbol),funnel,legacyFixedLotReferencesReproduced:reproduced,bankUsdt:17,lotCeilingUsdt:10,riskLimits:config.profile.riskLimits,scenarios,staticFeasibility,runs,selection,status:selection.some(s=>s.eligibleForFutureIndependentProtocol)?'development_screen_passed_not_validated':'blocked_no_eligible_candidate',configurationPromoted:false,realMoneyApproved:false};
}

export { screenEconomicCandidates } from './hybrid-economic-screen.js';
