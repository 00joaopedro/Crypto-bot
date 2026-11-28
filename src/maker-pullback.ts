import { emaSeries,averageTrueRange } from './indicators.js';
import { aggregateFourHours } from './trend-horizon.js';
import { positionSize } from './position-sizing.js';
import { quantizeQuantityDown } from './decimal-quantity.js';
import { semanticHash } from './cost-experiments.js';
import { tradeProfitConcentration } from './backtest-performance.js';
import { ResearchMakerOrder,type MakerRules } from './maker-research-order.js';
import { Precise } from 'ccxt';
import type { Candle } from './types.js';
import type { HybridInstrument } from './hybrid-research-replay.js';
export const MAKER_CORE=['BTC/USDT','ETH/USDT','SOL/USDT'] as const;
export type MakerSignal={symbol:string;decisionTimestamp:number;entryHour:number;limit:number;stop:number;target:number};
export type MakerMicro={windows:Array<{symbol:string;hour:number;candles:Candle[]}>;publicRulesMatched:boolean;missing:Array<{symbol:string;hour:number;reason:string}>};
export function validateMakerBars(bars:Candle[],duration:number){
 if(!bars.length)throw new Error('Missing research candles');
 for(let i=0;i<bars.length;i++){const c=bars[i]!;if(![c.timestamp,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)||!Number.isSafeInteger(c.timestamp)||c.timestamp<0||c.timestamp%duration||Math.min(c.open,c.close,c.low)<=0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.volume<0||(i>0&&c.timestamp-bars[i-1]!.timestamp!==duration))throw new Error('Invalid, duplicate or non-contiguous maker candles');}
}
export function makerPullbackChecks(history:Candle[],four:Candle[]){
 const current=history.at(-1),previous=history.at(-2);if(!current||!previous||history.length<84)return null;
 const closed=four.filter(c=>c.timestamp+14400000<=current.timestamp+3600000);if(closed.length<250)return null;
 const fast=emaSeries(closed.map(c=>c.close),50),slow=emaSeries(closed.map(c=>c.close),200),ema=emaSeries(history.map(c=>c.close),21),level=ema.at(-1)!;
 const atr=averageTrueRange(history,14),body=Math.abs(current.close-current.open),wick=Math.min(current.open,current.close)-current.low;
 return {level,atr,structureLow:Math.min(...history.slice(-3).map(c=>c.low)),checks:{regime:fast.at(-1)!>slow.at(-1)!&&[1,2,3].every(k=>fast.at(-k)!>fast.at(-k-1)!),previous_above:previous.close>ema.at(-2)!,touch:current.low<=level,recovery:current.close>level,green:current.close>current.open,rejection:wick>=body,atr_valid:Number.isFinite(atr)&&atr>0}};
}
export function scanMakerPullbacks(data:{instruments:HybridInstrument[]},protocol:any){
 const signals:MakerSignal[]=[],funnel=[];
 for(const symbol of MAKER_CORE){
  const matches=data.instruments.filter(d=>d.symbol===symbol);if(matches.length!==1)throw new Error('Distinct core histories required');const d=matches[0]!,hours=d.candles15m;
  validateMakerBars(hours,3600000);if(hours.length!==3160||hours[1000]!.timestamp!==Date.parse(protocol.window.evaluationStartUtc)||hours.at(-1)!.timestamp+3600000!==Date.parse(protocol.window.endExclusiveUtc))throw new Error('Frozen maker window mismatch');
  const four=aggregateFourHours(hours),rules=protocol.rules[symbol] as MakerRules,row={symbol,decisions:0,rawSignals:0,transitions:0,signals:0,passed:{} as Record<string,number>};let prior=false;
  for(let i=999;i<hours.length-1;i++){
   const f=makerPullbackChecks(hours.slice(0,i+1),four);if(!f)throw new Error('Closed macro warmup required');const current=Object.values(f.checks).every(Boolean),transition=current&&!prior;prior=current;
   if(i<1000)continue;row.decisions++;row.rawSignals+=Number(current);row.transitions+=Number(transition);for(const[k,v]of Object.entries(f.checks))row.passed[k]=(row.passed[k]??0)+Number(v);
   if(transition){const limit=quantizeQuantityDown(f.level,1,rules.priceTick).quantity,rawStop=f.structureLow-.25*f.atr;if(rawStop<=0)continue;const stop=quantizeQuantityDown(rawStop,1,rules.priceTick).quantity,target=quantizeQuantityDown(limit+2*(limit-stop),1,rules.priceTick).quantity;
    if(stop>0&&stop<limit&&target>limit){signals.push({symbol,decisionTimestamp:hours[i]!.timestamp,entryHour:hours[i+1]!.timestamp,limit,stop,target});row.signals++;}
   }
  }funnel.push(row);
 }
 signals.sort((a,b)=>a.entryHour-b.entryHour||MAKER_CORE.indexOf(a.symbol as typeof MAKER_CORE[number])-MAKER_CORE.indexOf(b.symbol as typeof MAKER_CORE[number]));return {signals,funnel};
}
export function validateMakerMicro(data:{instruments:HybridInstrument[]},signals:MakerSignal[],micro:MakerMicro){
 const expected=new Map(signals.map(s=>[s.symbol+':'+s.entryHour,s])),seen=new Set<string>();
 for(const w of micro.windows){const key=w.symbol+':'+w.hour;if(seen.has(key)||!expected.has(key))throw new Error('Duplicate or unrequested minute window');seen.add(key);validateMakerBars(w.candles,60000);
  if(w.candles.length!==60||w.candles[0]!.timestamp!==w.hour||w.candles.at(-1)!.timestamp!==w.hour+3540000)throw new Error('Complete60-minute entry hour required');
  const h=data.instruments.find(d=>d.symbol===w.symbol)?.candles15m.find(c=>c.timestamp===w.hour);if(!h)throw new Error('Minute/hour identity mismatch');
  const traded=w.candles.filter(c=>c.volume>0),q=traded.length?traded:w.candles,aggregate={open:q[0]!.open,close:q.at(-1)!.close,high:Math.max(...q.map(c=>c.high)),low:Math.min(...q.map(c=>c.low)),volume:w.candles.reduce((s,c)=>s+c.volume,0)};
  if((['open','close','high','low','volume'] as const).some(k=>Math.abs(h[k]-aggregate[k])>1e-6*Math.max(1,h[k],aggregate[k])))throw new Error('Minute/hour candles disagree');
 }
 return [...expected.keys()].filter(k=>!seen.has(k));
}
export function makerPayoff(quantity:number,s:MakerSignal,maker:number,taker:number,friction:number,step:number){
 const afterBaseFee=Number(new Precise(String(quantity)).mul(new Precise('1').sub(new Precise(String(maker)))).toString());
 const sellable=quantizeQuantityDown(afterBaseFee,1,step).quantity,cost=quantity*s.limit,proceeds=(p:number)=>sellable*p*(1-friction)*(1-taker),gain=proceeds(s.target)-cost,loss=cost-proceeds(s.stop),roundtrip=cost-proceeds(s.limit);
 return {sellable,gain,loss,roundtrip,passed:gain>0&&loss>0&&gain/loss>=1.5&&roundtrip>=0&&gain>=2*roundtrip};
}
type Closed={symbol:string;entryTimestamp:number;exitTimestamp:number;entryNotionalUsdt:number;netPnlUsdt:number;feesUsdt:number;quantity:number;entryPrice:number;exitPrice:number;reason:string;dustQuantity:number;holdingMinutesUpperBound:number};
function stats(trades:Closed[]){const gains=trades.reduce((s,t)=>s+Math.max(0,t.netPnlUsdt),0),losses=trades.reduce((s,t)=>s+Math.max(0,-t.netPnlUsdt),0),net=gains-losses;return {closedTrades:trades.length,realizedPnlUsdt:net,profitFactor:losses>0?gains/losses:null,expectancyUsdt:trades.length?net/trades.length:null,winRatePercent:trades.length?100*trades.filter(t=>t.netPnlUsdt>0).length/trades.length:null,...tradeProfitConcentration(trades.map(t=>t.netPnlUsdt),gains,net)};}

/** Minute execution is a declared OHLC/participation model, never proof of queue priority or native fills. */
export function replayMakerPullback(data:{instruments:HybridInstrument[]},signals:MakerSignal[],micro:MakerMicro,protocol:any,scenario:any){
 const missing=validateMakerMicro(data,signals,micro);if(missing.length)return {status:'blocked_missing_minute_data',missingWindows:missing.length,closedTrades:null,ordersSent:0,realMoneyApproved:false};
 const hours=data.instruments.find(d=>d.symbol===MAKER_CORE[0])!.candles15m,windows=new Map(micro.windows.map(w=>[w.symbol+':'+w.hour,w.candles]));
 let cash=17,equity=17,peak=17,dd=0,ddPct=0,fees=0,day=-1,dayStart=17,halted=false;
 type Active={order:ResearchMakerOrder;signal:MakerSignal;entryTimestamp:number};let active:Active|undefined;
 const closed:Closed[]=[],orders:Array<Record<string,unknown>>=[],events:Array<Record<string,unknown>>=[],marks:number[]=[],rejected:Record<string,number>={};
 const reject=(reason:string)=>{rejected[reason]=(rejected[reason]??0)+1;};
 const friction=(1+scenario.slippageRate)*(1+scenario.spreadRate/2)-1;
 const closePosition=(bar:Candle,allowTarget:boolean,barDuration=3600000)=>{
  if(!active)return;const {signal:s,order:o}=active;
  if(o.unprotectablePartial){o.cancel();halted=true;events.push({type:'unprotectable_partial',symbol:s.symbol,timestamp:bar.timestamp,receivedBase:o.receivedBase});return;}
  if(o.receivedBase<=0)return;
  const stop=bar.low<=s.stop,target=allowTarget&&bar.high>=s.target;
  if(!stop&&!target)return;
  const reference=stop?Math.min(bar.open,s.stop):s.target,out=o.close(reference,scenario.takerRate,friction);cash+=out.proceedsUsdt;fees+=out.feesUsdt-o.buyFeesUsdt;
  closed.push({symbol:s.symbol,entryTimestamp:active.entryTimestamp,exitTimestamp:bar.timestamp,entryNotionalUsdt:o.spentUsdt,netPnlUsdt:out.netPnlUsdt,feesUsdt:out.feesUsdt,quantity:out.quantity,entryPrice:o.limit,exitPrice:out.exitPrice,reason:stop?'STOP_LOSS':'TAKE_PROFIT',dustQuantity:out.dustQuantity,holdingMinutesUpperBound:(bar.timestamp-active.entryTimestamp)/60000+barDuration/60000});
  events.push({type:'position_closed',symbol:s.symbol,timestamp:bar.timestamp,reservedUsdt:o.reservedUsdt});active=undefined;
 };
 for(let i=1000;i<hours.length;i++){
  const time=hours[i]!.timestamp,today=Math.floor(time/86400000);if(today!==day){day=today;dayStart=equity;}
  const candidates=signals.filter(s=>s.entryHour===time),hadPosition=active!==undefined;
  if(hadPosition){for(const _ of candidates)reject('position_occupied');const bar=data.instruments.find(d=>d.symbol===active!.signal.symbol)!.candles15m[i]!;closePosition(bar,true);}
  if(!hadPosition&&!halted){
   for(let index=0;index<candidates.length;index++){
    const s=candidates[index]!,rules=protocol.rules[s.symbol] as MakerRules;
    if(cash<=dayStart*.97||cash<=peak*.9){reject('portfolio_risk_halt');continue;}
    if(closed.length>=3&&closed.slice(-3).every(t=>t.netPnlUsdt<0)&&time<closed.at(-1)!.exitTimestamp+3600000+3600000){reject('loss_cooldown');continue;}
    const size=positionSize({limits:protocol.riskLimits,equity:cash,free:cash,exposure:0,altExposure:0,symbolExposure:0,altcoin:s.symbol!=='BTC/USDT',ceiling:10,stopRate:1-s.stop/s.limit,fee:Math.max(scenario.makerRate,scenario.takerRate),slippage:friction,liquidity:1000});
    if(size<=0){reject('risk_size');continue;}const quantity=quantizeQuantityDown(size,s.limit,rules.quantityStep).quantity;if(quantity<rules.minimumQuantity){reject('minimum_quantity');continue;}
    const payoff=makerPayoff(quantity,s,scenario.makerRate,scenario.takerRate,friction,rules.quantityStep);
    if(payoff.sellable<rules.minimumQuantity){reject('minimum_sellable_after_fee');continue;}if(!payoff.passed){reject('net_payoff_margin');continue;}if(payoff.loss>cash*.01){reject('stop_risk');continue;}
    const minute=windows.get(s.symbol+':'+time)!;
    // The opening trade plus modeled half-spread is only a posting proxy; no historical book is claimed.
    if(s.limit>=minute[0]!.open*(1+scenario.spreadRate/2)){reject('post_only_cross_proxy');continue;}
    const o=new ResearchMakerOrder(s.symbol+':'+time,s.limit,quantity,time,time+300000,scenario.makerRate,rules);
    orders.push({id:o.id,symbol:s.symbol,placedAt:time,expiresAt:o.expiresAt,limit:o.limit,quantity,cashBeforeUsdt:cash,initialReservedUsdt:o.reservedUsdt,freeCashAfterReservationUsdt:cash-o.reservedUsdt,projectedNetRewardRisk:payoff.gain/payoff.loss});
    for(let later=index+1;later<candidates.length;later++)reject('portfolio_priority');
    for(const bar of minute){
     o.expire(bar.timestamp);let filledNow=false;
     if((o.status==='live'||o.status==='partially_filled')&&bar.low<s.limit-rules.priceTick*scenario.penetrationTicks){
      const cap=Math.min(o.remainingQuantity,bar.volume*scenario.participationRate),q=cap>0?quantizeQuantityDown(cap,1,rules.quantityStep).quantity:0;
      if(q>0&&o.fill(o.id+':'+bar.timestamp,q,bar.timestamp)){cash-=q*o.limit;fees+=q*o.limit*scenario.makerRate;filledNow=true;if(!active)active={order:o,signal:s,entryTimestamp:bar.timestamp};events.push({type:'maker_fill',id:o.id,timestamp:bar.timestamp,quantity:q,status:o.status,cashUsdt:cash,reservedUsdt:o.reservedUsdt,freeCashUsdt:cash-o.reservedUsdt});}
     }
     if(active)closePosition(bar,!filledNow,60000);
     if(halted||o.status==='canceled'&&active===undefined)break;
    }
    o.expire(time+3600000);events.push({type:'order_terminal',id:o.id,status:o.status,filledQuantity:o.filledQuantity,receivedBase:o.receivedBase,reservedUsdt:o.reservedUsdt});
    break;
   }
  }
  if(active){const bar=data.instruments.find(d=>d.symbol===active!.signal.symbol)!.candles15m[i]!;equity=cash+active.order.sellableQuantity*bar.close*(1-friction)*(1-scenario.takerRate);}else equity=cash;
  marks.push(equity);peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);ddPct=Math.max(ddPct,100*(peak-equity)/peak);
  if(halted)break;
 }
 const blocks=[0,1,2].map(b=>{const from=1000+b*720,to=Math.min(hours.length,from+720),selected=closed.filter(t=>t.exitTimestamp>=hours[from]!.timestamp&&t.exitTimestamp<hours[to-1]!.timestamp+3600000),begin=marks[b*720-1]??17,end=marks[(b+1)*720-1];return {name:`D${b*30+1}-D${b*30+30}`,complete:end!==undefined,netReturnUsdt:end===undefined?null:end-begin,...stats(selected)};});
 return {status:halted?'blocked_unprotectable_partial':'modeled_replay_complete',scenario:scenario.name,...stats(closed),netReturnUsdt:equity-17,finalEquityUsdt:equity,feesUsdt:fees,maxDrawdownUsdt:dd,maxDrawdownPercent:ddPct,recoveryFactor:dd>0?(equity-17)/dd:null,ordersPlaced:orders.length,ordersWithFills:orders.filter(o=>events.some(e=>e.id===o.id&&e.type==='maker_fill')).length,fillEvents:events.filter(e=>e.type==='maker_fill').length,blocks,bySymbol:MAKER_CORE.map(symbol=>({symbol,...stats(closed.filter(t=>t.symbol===symbol))})),rejected,openPosition:active?{symbol:active.signal.symbol,receivedBase:active.order.receivedBase,sellableQuantity:active.order.sellableQuantity,stop:active.signal.stop,target:active.signal.target}:null,closedTradeLedger:closed,orders,events,ordersSent:0,realMoneyApproved:false};
}
export function makerSource(data:{instruments:HybridInstrument[]},protocol:any){if(semanticHash(data)!==protocol.sourceDatasetSha256)throw new Error('Frozen maker source identity mismatch');return scanMakerPullbacks(data,protocol);}
