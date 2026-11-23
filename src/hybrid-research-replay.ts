import { z } from "zod";
import { positionSize,positionSizingSchema,type PositionSizingLimits } from "./position-sizing.js";
import { Precise } from "ccxt";
import { hybridPlanSchema,hybridFeatures,hybridDecisions,HYBRID_WATCHLIST,type HybridDecision,type ResearchMode } from "./hybrid-research-signals.js";
import { PaperTrader,type PaperTradeClosed } from "./paper-trader.js";
import { comparisonSchema,comparisonSlippage,scenarioCosts,type ComparisonOptions } from "./strategy-comparison.js";
import { initialExitRates } from "./exit-policy.js";
import { quantizeQuantityDown } from "./decimal-quantity.js";
import { netActivationPrice } from "./research-trailing.js";
import { averageTrueRange } from "./indicators.js";
import { evaluateStrategy } from "./strategy.js";
import { assessMarketQuality } from "./signal-ranking.js";
import { pairCooldownUntil } from "./pair-cooldown.js";
import { tradeProfitConcentration } from "./backtest-performance.js";
import type { Candle } from "./types.js";
export type HybridInstrument={symbol:string;candles15m:Candle[];candles1h:Candle[];constraints:ComparisonOptions['constraints'];quoteVolumesUsdt?:number[]|undefined};
export type HybridVariant='baseline'|'trend_pullback'|'mean_reversion'|'hybrid';
export type HybridTrade=Omit<PaperTradeClosed,'reason'>&{reason:PaperTradeClosed['reason']|'TIME_STOP';symbol:string;strategy_mode:ResearchMode;holdingCandles:number;exitTimeProxy:number|null};
const interval=900000;
function validateBars(candles:Candle[],duration:number){
 if(!candles.length)throw new Error('Empty research series');
 for(let i=0;i<candles.length;i++){
  const c=candles[i]!;
  if(![c.timestamp,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)||!Number.isSafeInteger(c.timestamp)||c.timestamp<0||c.timestamp%duration||Math.min(c.open,c.low,c.close)<=0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.volume<0||(i>0&&c.timestamp-candles[i-1]!.timestamp!==duration))throw new Error('Research candles must be valid, aligned, ordered and contiguous');
 }
}
export function validateHybridInputs(instruments:HybridInstrument[],rawPlan:unknown,allowWarmupOnly=false){
 const plan=hybridPlanSchema.parse(rawPlan);
 if(!instruments.length||new Set(instruments.map(d=>d.symbol)).size!==instruments.length)throw new Error('Distinct watchlist instruments required');
 const clock=instruments[0]!.candles15m;
 if(clock.length-plan.warmup15m>2880)throw new Error('At most 30 evaluation days per protocol');
 for(const d of instruments){
  if(!plan.watchlist.includes(d.symbol))throw new Error('Instrument outside the frozen watchlist');
  comparisonSchema.shape.constraints.parse(d.constraints);validateBars(d.candles15m,interval);validateBars(d.candles1h,3600000);
  if((d.candles15m.length<plan.warmup15m||(!allowWarmupOnly&&d.candles15m.length===plan.warmup15m))||d.candles15m.length!==clock.length||d.candles15m.some((c,i)=>c.timestamp!==clock[i]!.timestamp))throw new Error('Aligned histories with sufficient warmup required');
  if(d.candles1h.filter(c=>c.timestamp+3600000<=clock[Math.min(plan.warmup15m,clock.length-1)]!.timestamp+interval).length<plan.warmup1h)throw new Error('Need 250 fully closed hours at the first decision');
  if(d.quoteVolumesUsdt&&(d.quoteVolumesUsdt.length!==clock.length||d.quoteVolumesUsdt.some(v=>!Number.isFinite(v)||v<0)))throw new Error('Invalid quote volume history');
  const slots=new Map(d.candles15m.map(c=>[c.timestamp,c]));
  for(const h of d.candles1h){
   const quarters=[0,1,2,3].map(k=>slots.get(h.timestamp+k*interval));
   if(quarters.some(c=>!c))continue;
   const q=quarters as Candle[],traded=q.filter(c=>c.volume>0),prices=traded.length?traded:q;
   // Empty sub-bars carry the previous close; they are not trades setting the hourly open/high/low.
   const aggregate={open:prices[0]!.open,high:Math.max(...prices.map(c=>c.high)),low:Math.min(...prices.map(c=>c.low)),close:prices.at(-1)!.close,volume:q.reduce((s,c)=>s+c.volume,0)};
   if((['open','high','low','close','volume'] as const).some(key=>Math.abs(h[key]-aggregate[key])>(key==='volume'?1e-6:1e-7)*Math.max(1,Math.abs(h[key]),Math.abs(aggregate[key]))))throw new Error('Hourly and 15m candles disagree');
  }
 }
 return plan;
}
/** Separate pure scanner, never imported by the operational scanner or bot. */
export function scanHybridResearch(instruments:HybridInstrument[],rawPlan:unknown,variant:HybridVariant,baseline:ComparisonOptions['baseline']){
 const plan=validateHybridInputs(instruments,rawPlan);
 if(!['baseline','trend_pullback','mean_reversion','hybrid'].includes(variant))throw new Error('Unknown research variant');
 return new Map(instruments.map(d=>[d.symbol,d.candles15m.map((c,i):HybridDecision[]=>{
  if(i<plan.warmup15m)return [];
  const history=d.candles15m.slice(0,i+1);
  if(variant==='baseline'){
   const runtimeHistory=history.slice(-100),signal=evaluateStrategy(runtimeHistory,{minimumScore:baseline.minimumSignalScore,maxBuyRsi:baseline.maxBuyRsi??70});
   return signal.action==='BUY'&&assessMarketQuality(runtimeHistory).score>=3?[{strategy_mode:'BASELINE',decisionTimestamp:c.timestamp,atr:averageTrueRange(runtimeHistory),pullbackLow:c.low,sma20:c.close}]:[];
  }
  const f=hybridFeatures(history,d.candles1h);if(!f||assessMarketQuality(history.slice(-100)).score<3)return [];
  return hybridDecisions(f).filter(s=>variant==='hybrid'||s.strategy_mode===(variant==='trend_pullback'?'TREND_PULLBACK':'MEAN_REVERSION'));
 })]));
}
function closedMetrics(trades:HybridTrade[]){
 const win=trades.reduce((s,t)=>s+Math.max(0,t.netPnlUsdt),0),loss=trades.reduce((s,t)=>s+Math.max(0,-t.netPnlUsdt),0),net=win-loss;
 return {closedTrades:trades.length,realizedPnlUsdt:net,winRatePercent:trades.length?100*trades.filter(t=>t.netPnlUsdt>0).length/trades.length:null,profitFactor:loss>0?win/loss:null,expectancyUsdt:trades.length?net/trades.length:null,...tradeProfitConcentration(trades.map(t=>t.netPnlUsdt),win,net)};
}
/** Low-level offline kernel. Decisions must be frozen at the PREVIOUS candle, including mode and target. */
export function replayHybridDecisions(instruments:HybridInstrument[],decisions:ReadonlyMap<string,ReadonlyArray<readonly HybridDecision[]>>,rawPlan:unknown,rawScenario:ComparisonOptions['scenarios'][number],baseline:ComparisonOptions['baseline'],start:number,rawRiskLimits?:PositionSizingLimits){
 const plan=hybridPlanSchema.parse(rawPlan),scenario=comparisonSchema.shape.scenarios.element.parse(rawScenario),clock=instruments[0]?.candles15m;
 if(!clock||!Number.isInteger(start)||start<1||start>=clock.length||clock.length-start>2880)throw new Error('Valid replay clock/start required');
 if(new Set(instruments.map(d=>d.symbol)).size!==instruments.length)throw new Error('Duplicate replay instrument');
 for(const d of instruments){if(!plan.watchlist.includes(d.symbol))throw new Error('Instrument outside watchlist');validateBars(d.candles15m,interval);if(d.candles15m.length!==clock.length||d.candles15m.some((c,i)=>c.timestamp!==clock[i]!.timestamp))throw new Error('Replay clocks differ');comparisonSchema.shape.constraints.parse(d.constraints);if(d.quoteVolumesUsdt&&(d.quoteVolumesUsdt.length!==clock.length||d.quoteVolumesUsdt.some(v=>!Number.isFinite(v)||v<0)))throw new Error('Invalid quote volume history');}
 const riskLimits=rawRiskLimits===undefined?undefined:positionSizingSchema.parse(rawRiskLimits);
 const ordered=[...instruments].sort((a,b)=>HYBRID_WATCHLIST.indexOf(a.symbol)-HYBRID_WATCHLIST.indexOf(b.symbol));
 type Active={d:HybridInstrument;trader:PaperTrader;mode:ResearchMode;entryIndex:number;initialStop:number;high:number;activated:boolean};
 let active:Active|undefined,cash=plan.bankUsdt as number,equity=cash,peak=cash,maxDrawdownUsdt=0,maxDrawdownPercent=0,feesUsdt=0,peakExposureRate=0;
 let riskDay=-1,dayStartEquity=cash;
 const trades:HybridTrade[]=[],entries:Array<{symbol:string;strategy_mode:ResearchMode;decisionTimestamp:number;entryTimestamp:number;stopPrice:number;targetPrice:number;notionalUsdt:number;estimatedInitialLossUsdt:number}>=[],marks:number[]=[];
 const rejected:Record<string,number>={},cooldowns=new Map<string,number>();
 const reject=(r:string)=>{rejected[r]=(rejected[r]??0)+1;};
 const process=(p:Active,i:number,open:boolean,rates?:{stopLossRate:number;takeProfitRate:number;referencePrice:number})=>{
  const c=p.d.candles15m[i]!,costs=scenarioCosts(scenario,p.d.symbol),slip=comparisonSlippage(costs),before=p.trader.exportState().totalFeesUsdt;
  const timeStop=p.mode==='MEAN_REVERSION'&&i-p.entryIndex+1>=6;
  const priorStop=p.trader.exportState().position?.stopLossPrice??p.initialStop;
  const result=p.trader.processCandle(c,open,rates,!open&&timeStop,open?c.open:undefined);
  feesUsdt+=p.trader.exportState().totalFeesUsdt-before;
  for(const e of result.events){
   if(e.type==='OPENED'){
    const cost=e.notionalUsdt+(e.entryFeeCurrency==='base'?0:e.feeUsdt);
    entries.push({symbol:p.d.symbol,strategy_mode:p.mode,decisionTimestamp:p.d.candles15m[i-1]!.timestamp,entryTimestamp:c.timestamp,stopPrice:e.stopLossPrice,targetPrice:e.takeProfitPrice,notionalUsdt:e.notionalUsdt,estimatedInitialLossUsdt:cost-e.quantity*e.stopLossPrice*(1-slip)*(1-costs.feeRate)});
    peakExposureRate=Math.max(peakExposureRate,e.notionalUsdt/equity);
   }else{
    const raised=priorStop>p.initialStop;
    const reason=e.reason==='SIGNAL_CONTRARY'&&timeStop?'TIME_STOP':e.reason==='STOP_LOSS'&&raised?'TRAILING_STOP':e.reason;
    trades.push({...e,reason,symbol:p.d.symbol,strategy_mode:p.mode,holdingCandles:i-p.entryIndex+1,exitTimeProxy:reason==='TIME_STOP'?c.timestamp+interval:null});
    cash=p.trader.exportState().cashUsdt;
    if(baseline.pairCooldown){const recent=trades.filter(t=>t.symbol===p.d.symbol).slice(-baseline.pairCooldown.minLosses).reverse().map(t=>({closedAt:t.exitTimestamp+interval,netPnlUsdt:t.netPnlUsdt}));const until=pairCooldownUntil(recent,c.timestamp+interval,baseline.pairCooldown);if(until!==undefined)cooldowns.set(p.d.symbol,until);}
   }
  }
  if(!p.trader.hasOpenPosition)return false;
  if(p.mode==='TREND_PULLBACK'){
   const state=p.trader.exportState(),pos=state.position!,cost=pos.entryNotional+(pos.entryFeeCurrency==='base'?0:pos.entryFee);
   p.high=Math.max(p.high,c.high);
   p.activated ||= c.close>=netActivationPrice(cost,pos.quantity,costs.feeRate,slip,.012);
   if(p.activated){
    const floor=netActivationPrice(cost,pos.quantity,costs.feeRate,slip,.007),atr=averageTrueRange(p.d.candles15m.slice(Math.max(0,i-99),i+1));
    const trailing=atr>0?p.high-1.2*atr:pos.stopLossPrice;
    // Crossed proposals cannot fill retroactively. Retain any valid floor separately.
    pos.stopLossPrice=Math.max(pos.stopLossPrice,...[floor,trailing].filter(level=>level<c.close));p.trader.restoreState(state);
   }
  }
  return true;
 };
 for(let i=start;i<clock.length;i++){
  const day=Math.floor(clock[i]!.timestamp/86400000);if(day!==riskDay){riskDay=day;dayStartEquity=equity;}
  const hadPosition=active!==undefined;
  if(active&&!process(active,i,false))active=undefined;
  if(!hadPosition){
   const candidates=ordered.flatMap(d=>(decisions.get(d.symbol)?.[i-1]??[]).map(signal=>({d,signal}))).sort((a,b)=>HYBRID_WATCHLIST.indexOf(a.d.symbol)-HYBRID_WATCHLIST.indexOf(b.d.symbol)||(['TREND_PULLBACK','MEAN_REVERSION','BASELINE'].indexOf(a.signal.strategy_mode)-['TREND_PULLBACK','MEAN_REVERSION','BASELINE'].indexOf(b.signal.strategy_mode)));
   for(const {d,signal} of candidates){
    if(signal.decisionTimestamp!==clock[i-1]!.timestamp||!['BASELINE','TREND_PULLBACK','MEAN_REVERSION'].includes(signal.strategy_mode)||!Number.isFinite(signal.atr)||signal.atr<=0||!Number.isFinite(signal.sma20)||signal.sma20<=0||!Number.isFinite(signal.pullbackLow)||signal.pullbackLow<=0)throw new Error('Invalid frozen hybrid decision');
    const c=d.candles15m[i]!,costs=scenarioCosts(scenario,d.symbol),slip=comparisonSlippage(costs),fill=c.open*(1+slip);
    if((cooldowns.get(d.symbol)??0)>c.timestamp){reject('cooldown');continue;}
    const quote=d.quoteVolumesUsdt?.[i-1]??d.candles15m[i-1]!.volume*d.candles15m[i-1]!.close;
    const liquidity=Math.min(scenario.assumedDepthUsdt,quote*scenario.maxParticipationRate);
    let budget:number=plan.lotUsdt;
    if(riskLimits){
     if(cash<=dayStartEquity*.97||cash<=peak*.9){reject('portfolio_risk_halt');continue;}
     const lastLosses=trades.slice(-3);
     if(lastLosses.length===3&&lastLosses.every(t=>t.netPnlUsdt<0)&&c.timestamp<lastLosses[2]!.exitTimestamp+interval+3600000){reject('loss_cooldown');continue;}
     let plannedStop=signal.strategy_mode==='TREND_PULLBACK'?Math.max(fill*.989,signal.pullbackLow-1.5*signal.atr):fill*.988;
     if(signal.strategy_mode==='BASELINE'){
      const rates=initialExitRates(d.candles15m.slice(Math.max(0,i-100),i),d.candles15m[i-1]!.close,baseline.exitPolicy!,baseline);
      plannedStop=c.open*(1+costs.spreadRate/2)*(1-rates.stopLossRate);
     }
     if(plannedStop<=0||plannedStop>=fill){reject('exit_levels');continue;}
     budget=positionSize({limits:riskLimits,equity:cash,free:cash,exposure:0,altExposure:0,symbolExposure:0,altcoin:d.symbol!=='BTC/USDT',ceiling:plan.lotUsdt,stopRate:1-plannedStop/fill,fee:costs.feeRate,slippage:slip,liquidity});
     if(budget<=0){reject('risk_size');continue;}
    }else if(budget>liquidity){reject('liquidity');continue;}
    const order=quantizeQuantityDown(budget,fill,d.constraints.quantityStep),cost=order.notional*(costs.entryFeeCurrency==='quote'?1+costs.feeRate:1);
    const quantity=Number(new Precise(String(order.quantity)).mul((costs.entryFeeCurrency==='base'?new Precise("1").sub(new Precise(String(costs.feeRate))):new Precise("1"))).toString());
    const sellable=quantity>0?quantizeQuantityDown(quantity,1,d.constraints.quantityStep).quantity:0;
    if(order.quantity<=0||order.quantity<d.constraints.minimumQuantity||order.notional<d.constraints.minimumNotionalUsdt||sellable<=0||sellable<d.constraints.minimumQuantity||sellable*fill<d.constraints.minimumNotionalUsdt){reject('minimum');continue;}
    if(cost>cash){reject('cash');continue;}
    let stop:number,target:number;
    if(signal.strategy_mode==='BASELINE'){
     const history=d.candles15m.slice(Math.max(0,i-100),i),rates=initialExitRates(history,history.at(-1)!.close,baseline.exitPolicy!,baseline),ask=c.open*(1+costs.spreadRate/2);
     stop=ask*(1-rates.stopLossRate);target=ask*(1+rates.takeProfitRate);
    }else if(signal.strategy_mode==='TREND_PULLBACK'){
     stop=Math.max(fill*(1-.011),signal.pullbackLow-1.5*signal.atr);target=netActivationPrice(cost,quantity,costs.feeRate,slip,.028);
    }else{stop=fill*(1-.012);target=Math.min(signal.sma20,netActivationPrice(cost,quantity,costs.feeRate,slip,.014));}
    if(!(stop>0&&stop<fill&&target>fill&&target/fill-1<1)){reject('exit_levels');continue;}
    if(signal.strategy_mode!=='BASELINE'&&target*quantity*(1-costs.feeRate)*(1-slip)<=cost){reject('target_costs');continue;}
    const trader=new PaperTrader({initialBalanceUsdt:cash,tradeSizeUsdt:budget,feeRate:costs.feeRate,entryFeeCurrency:costs.entryFeeCurrency,slippageRate:slip,stopLossRate:1-stop/fill,takeProfitRate:target/fill-1,executionConstraints:d.constraints});
    const p:Active={d,trader,mode:signal.strategy_mode,entryIndex:i,initialStop:stop,high:fill,activated:false};
    if(process(p,i,true,{stopLossRate:1-stop/fill,takeProfitRate:target/fill-1,referencePrice:fill}))active=p;
    break; // One admitted entry per bar; no same-bar reuse of proceeds or mode switching.
   }
  }
  if(active){const state=active.trader.exportState(),p=state.position!,costs=scenarioCosts(scenario,active.d.symbol);equity=state.cashUsdt+p.quantity*active.d.candles15m[i]!.close*(1-costs.feeRate);}else equity=cash;
  marks.push(equity);peak=Math.max(peak,equity);maxDrawdownUsdt=Math.max(maxDrawdownUsdt,peak-equity);maxDrawdownPercent=Math.max(maxDrawdownPercent,100*(peak-equity)/peak);
 }
 const netReturnUsdt=equity-plan.bankUsdt;
 const blocks=[0,1,2].map(b=>{const from=start+b*960,to=Math.min(clock.length,from+960),blockTrades=trades.filter(t=>t.exitTimestamp>=(clock[from]?.timestamp??Infinity)&&t.exitTimestamp<(clock[to-1]?.timestamp??-Infinity)+interval),begin=marks[b*960-1]??plan.bankUsdt,end=to>from?marks[to-start-1]!:begin;return {name:`D${b*10+1}-D${b*10+10}`,complete:to-from===960,candles:Math.max(0,to-from),netReturnUsdt:end-begin,...closedMetrics(blockTrades)};});
 return {status:'offline_research_only',...(riskLimits?{allocationMode:'risk_preserving_ceiling',riskLimits,dailyLossHaltRate:.03,drawdownHaltRate:.1}:{}),...closedMetrics(trades),netReturnUsdt,netReturnPercent:100*netReturnUsdt/plan.bankUsdt,finalEquityUsdt:equity,maxDrawdownUsdt,maxDrawdownPercent,recoveryFactor:maxDrawdownUsdt>0?netReturnUsdt/maxDrawdownUsdt:null,feesUsdt,peakExposureRate,peakConcurrentPositions:entries.length?1:0,
  byMode:(['BASELINE','TREND_PULLBACK','MEAN_REVERSION'] as const).map(strategy_mode=>({strategy_mode,...closedMetrics(trades.filter(t=>t.strategy_mode===strategy_mode))})),blocks,entries,closedTradeLedger:trades,rejected,
  openPosition:active?{symbol:active.d.symbol,strategy_mode:active.mode,entryTimestamp:active.d.candles15m[active.entryIndex]!.timestamp,stopPrice:active.trader.exportState().position!.stopLossPrice,targetPrice:active.trader.exportState().position!.takeProfitPrice}:null,
  configurationPromoted:false,realMoneyApproved:false};
}
