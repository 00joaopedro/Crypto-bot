import { emaSeries,averageTrueRange,rsiSeries } from './indicators.js';
import { hybridDecisions,utcResearchVwap,type HybridFeatures,type HybridDecision } from './hybrid-research-signals.js';
import { assessMarketQuality } from './signal-ranking.js';
import { replayHybridDecisions,type HybridInstrument } from './hybrid-research-replay.js';
import { semanticHash } from './cost-experiments.js';
import { shadowConfiguration } from './hybrid-shadow-session.js';
import type { Candle } from './types.js';
export function aggregateFourHours(hours:Candle[]){
 const result:Candle[]=[];
 for(let i=0;i<hours.length;i+=4){const q=hours.slice(i,i+4);if(q.length!==4||q[0]!.timestamp%14400000||q.some((c,k)=>c.timestamp!==q[0]!.timestamp+k*3600000))throw new Error('Contiguous UTC4h groups required');const traded=q.filter(c=>c.volume>0),prices=traded.length?traded:q;
  result.push({timestamp:q[0]!.timestamp,open:prices[0]!.open,high:Math.max(...prices.map(c=>c.high)),low:Math.min(...prices.map(c=>c.low)),close:prices.at(-1)!.close,volume:q.reduce((s,c)=>s+c.volume,0)});
 }return result;
}
export function horizonFeatures(history:Candle[],fourHours:Candle[]):HybridFeatures|null{
 if(history.length<84)return null;const current=history.at(-1)!,previous=history.at(-2)!,closed=fourHours.filter(c=>c.timestamp+14400000<=current.timestamp+3600000);
 if(closed.length<250)return null;const closes=history.map(c=>c.close),ema=emaSeries(closes,21),rsi=rsiSeries(closes,14),vol=history.slice(-22,-2).reduce((s,c)=>s+c.volume,0)/20,macro=closed.map(c=>c.close);
 return {previous,current,previousEma21:ema.at(-2)!,ema21:ema.at(-1)!,previousVwap:utcResearchVwap(history.slice(0,-1)),previousRsi14:rsi.at(-2)!,rsi14:rsi.at(-1)!,previousVolumeRatio:vol?previous.volume/vol:Infinity,atr14:averageTrueRange(history,14),previousAtr14:averageTrueRange(history.slice(0,-1),14),macroBullish:emaSeries(macro,50).at(-1)!>emaSeries(macro,200).at(-1)!,previousRsi7:100,previousLowerBand:0,lowerBand:0,sma20:closes.slice(-20).reduce((a,b)=>a+b,0)/20,adx14:100};
}
export function runTrendHorizon(data:{instruments:HybridInstrument[];source:unknown},protocol:any,rawPlan:unknown,rawReference:unknown,rawProfile:unknown){
 const config=shadowConfiguration(rawProfile,rawPlan,rawReference),start=Date.parse(protocol.window.evaluationStartUtc),end=Date.parse(protocol.window.endExclusiveUtc),maps=new Map<string,HybridDecision[][]>();
 if(protocol.protocol!=='trend-horizon-development-v1'||end-start!==90*86400000||protocol.window.warmupHours!==1000||JSON.stringify(data.instruments.map(d=>d.symbol))!==JSON.stringify(protocol.universe)||semanticHash(protocol.riskLimits)!==semanticHash(config.profile.riskLimits))throw new Error('Frozen horizon identity/window mismatch');
 for(const d of data.instruments){if(d.candles15m.length!==3160||d.candles15m[0]!.timestamp!==start-1000*3600000||d.candles15m.at(-1)!.timestamp!==end-3600000)throw new Error('Incomplete horizon history');
  const four=aggregateFourHours(d.candles15m),rows:HybridDecision[][]=Array.from({length:d.candles15m.length},()=>[]);let previous=false;
  for(let i=999;i<d.candles15m.length-1;i++){const h=d.candles15m.slice(0,i+1),f=horizonFeatures(h,four);if(!f)throw new Error('Insufficient4h warmup');const raw=assessMarketQuality(h.slice(-100)).score>=3?hybridDecisions(f).filter(s=>s.strategy_mode==='TREND_PULLBACK'):[],current=raw.length>0;if(i>=1000&&current&&!previous)rows[i]=raw;previous=current;}maps.set(d.symbol,rows);
 }
 const runs=[];
 for(const name of ['HORIZON_REFERENCE','HORIZON_ATR'] as const)for(const scenario of protocol.scenarios as typeof config.reference.scenarios){const result=replayHybridDecisions(data.instruments,maps,config.strategy,scenario,config.reference.parameters,1000,config.profile.riskLimits,undefined,undefined,name==='HORIZON_ATR'?'horizon':'horizon_reference',3600000);runs.push({name,scenario:scenario.name,...result});}
 const candidate=runs.filter(r=>r.name==='HORIZON_ATR'),checks=candidate.map(r=>({scenario:r.scenario,sample:r.closedTrades>=30,pf:r.profitFactor!==null&&r.profitFactor>1.25,ev:r.expectancyUsdt!==null&&r.expectancyUsdt>0,net:r.netReturnUsdt>0,blocks:r.blocks.every(b=>b.complete&&b.netReturnUsdt>0),drawdown:r.maxDrawdownPercent<10,withoutTop3:r.realizedPnlWithoutTop3Usdt>0})),eligible=checks.length===2&&checks.every(c=>c.sample&&c.pf&&c.ev&&c.net&&c.blocks&&c.drawdown&&c.withoutTop3);
 return {protocol:protocol.protocol,timeframe:'1h',context:'4h',window:protocol.window,datasetSha256:semanticHash(data),bankUsdt:17,lotCeilingUsdt:10,signals:[...maps].map(([symbol,rows])=>({symbol,count:rows.reduce((n,r)=>n+r.length,0)})),runs,checks,status:eligible?'development_screen_passed_not_validated':'blocked_no_eligible_candidate',eligibleForFutureIndependentProtocol:eligible,independentDataCollected:false,configurationPromoted:false,realMoneyApproved:false,ordersSent:0};
}
