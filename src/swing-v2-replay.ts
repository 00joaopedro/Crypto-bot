import { quantizeQuantityDown } from './decimal-quantity.js';
import { positionSize } from './position-sizing.js';
import { tradeProfitConcentration } from './backtest-performance.js';
import { validateMakerBars } from './maker-pullback.js';
import { SwingV2Position,swingLevels,swingSellable,exitFriction,type SwingCosts } from './swing-v2-ledger.js';
import type { SwingData,SwingSignal,SwingWindow } from './swing-v2-signals.js';
import type { MakerMicro } from './maker-pullback.js';
export function validateSwingMicro(data:SwingData,micro:MakerMicro){
 const seen=new Set<string>();for(const w of micro.windows){const key=w.symbol+':'+w.hour;if(seen.has(key))throw new Error('Duplicate swing minute hour');seen.add(key);validateMakerBars(w.candles,60000);
  if(w.candles.length!==60||w.candles[0]!.timestamp!==w.hour||w.candles.at(-1)!.timestamp!==w.hour+3540000)throw new Error('Complete swing minute hour required');
  const h=data.instruments.find(d=>d.symbol===w.symbol)?.hours.find(c=>c.timestamp===w.hour);if(!h)throw new Error('Unrequested phase/instrument minute data');
  const traded=w.candles.filter(c=>c.volume>0),q=traded.length?traded:w.candles,aggregate={open:q[0]!.open,close:q.at(-1)!.close,high:Math.max(...q.map(c=>c.high)),low:Math.min(...q.map(c=>c.low)),volume:w.candles.reduce((s,c)=>s+c.volume,0)};
  if((['open','close','high','low','volume'] as const).some(k=>Math.abs(h[k]-aggregate[k])>1e-6*Math.max(1,h[k],aggregate[k])))throw new Error('Swing minute/hour disagreement');
 }
}
const sum=(v:number[])=>v.reduce((a,b)=>a+b,0);
function metrics(trades:any[]){const wins=sum(trades.map(t=>Math.max(0,t.netPnlUsdt))),losses=sum(trades.map(t=>Math.max(0,-t.netPnlUsdt))),net=wins-losses;return {closedTrades:trades.length,realizedPnlUsdt:net,grossWinsUsdt:wins,grossLossesUsdt:losses,profitFactor:losses>0?wins/losses:null,profitFactorKind:losses>0?'finite':wins>0?'unbounded':'undefined',expectancyUsdt:trades.length?net/trades.length:null,winRatePercent:trades.length?100*trades.filter(t=>t.netPnlUsdt>0).length/trades.length:null,...tradeProfitConcentration(trades.map(t=>t.netPnlUsdt),wins,net)};}
export function replaySwingV2(data:SwingData,signals:SwingSignal[],micro:MakerMicro,protocol:any,s:SwingCosts,window:SwingWindow){
 validateSwingMicro(data,micro);const hours=data.instruments[0]!.hours,map=new Map(micro.windows.map(w=>[w.symbol+':'+w.hour,w.candles]));
 const byHour=new Map<number,SwingSignal[]>();for(const signal of signals){const row=byHour.get(signal.entryHour)??[];row.push(signal);byHour.set(signal.entryHour,row);}
 let cash=17,equity=17,peak=17,dd=0,ddPct=0,day=-1,dayStart=17,halted=false,active:SwingV2Position|undefined,activeSignal:SwingSignal|undefined,firstFill=0;
 const closed:any[]=[],events:any[]=[],orders:any[]=[],marks:number[]=[],rejects:Record<string,number>={};const reject=(r:string)=>{rejects[r]=(rejects[r]??0)+1;};
 const need=(symbol:string,hour:number)=>({status:'awaiting_minute_evidence',scenario:s.name,needed:[{symbol,entryHour:hour}],ordersSent:0,realMoneyApproved:false});
 const processMinute=(bar:any)=>{
  if(!active)return;const p=active;let filled=false;
  p.expire(bar.timestamp);
  if((p.buy.status==='live'||p.buy.status==='partially_filled')&&bar.low<p.entry-protocol.rules[p.symbol].priceTick*s.penetrationTicks){
   const amount=Math.min(p.buy.remainingQuantity,bar.volume*s.participationRate),q=amount>0?quantizeQuantityDown(amount,1,p.rules.quantityStep).quantity:0;
   if(q>0&&p.buyFill(p.buy.id+':'+bar.timestamp,q,bar.timestamp)){cash-=q*p.entry;filled=true;if(!firstFill)firstFill=bar.timestamp;events.push({type:'buy_fill',id:p.buy.id,timestamp:bar.timestamp,quantity:q,price:p.entry,reservedUsdt:p.buy.reservedUsdt});}
  }
  if(p.unprotectable){p.buy.cancel();halted=true;events.push({type:'unprotectable_inventory',symbol:p.symbol,timestamp:bar.timestamp,quantity:p.remaining});return;}
  if(p.remaining<=0)return;
  const stop=bar.low<=p.stop;
  if(stop){const out=p.sellFill(p.buy.id+':stop:'+bar.timestamp,p.remaining,Math.min(bar.open,p.stop)*(1-exitFriction(s)),'taker');if(out)cash+=out.net;events.push({type:'stop_fill',symbol:p.symbol,timestamp:bar.timestamp,...out});}
  else if(!filled&&p.tpResting&&bar.timestamp>=p.tpFrom&&bar.high>p.target+p.rules.priceTick*s.penetrationTicks){
   const amount=Math.min(p.remaining,bar.volume*s.participationRate),q=amount>0?quantizeQuantityDown(amount,1,p.rules.quantityStep).quantity:0;
   if(q>0){const out=p.sellFill(p.buy.id+':target:'+bar.timestamp,q,p.target,'maker');if(out)cash+=out.net;events.push({type:'maker_target_fill',symbol:p.symbol,timestamp:bar.timestamp,...out});}
  }
  if(p.unprotectable){halted=true;events.push({type:'unprotectable_remainder',symbol:p.symbol,timestamp:bar.timestamp,quantity:p.remaining});return;}
  if(p.closed){closed.push({symbol:p.symbol,entryTimestamp:firstFill,exitTimestamp:bar.timestamp,entryPrice:p.entry,initialStop:p.initialStop,finalStop:p.stop,target:p.target,entryNotionalUsdt:p.buy.spentUsdt,initialQuantity:p.initialSellable,netPnlUsdt:p.netPnl,feesUsdt:p.fees,modeledBufferUsdt:p.bufferCost,dustQuantity:p.dust,initialNetRiskUsdt:p.initialRisk,reason:stop?(p.protected?'PROTECTED_STOP':'STOP_LOSS'):'MAKER_TARGET',protectionActivated:p.protected,entryOrderId:p.buy.id});active=undefined;activeSignal=undefined;firstFill=0;return;}
  if(filled||!p.tpResting){const posted=p.postTarget(bar.close,bar.timestamp+60000);if(posted)events.push({type:'target_posted',symbol:p.symbol,effectiveFrom:p.tpFrom,target:p.target,quantity:p.remaining});}
  const old=p.stop,proposal=p.protectAtClose(bar.close);if(proposal!==null)events.push({type:'protection_updated',symbol:p.symbol,timestamp:bar.timestamp+60000,effectiveFrom:bar.timestamp+60000,oldStop:old,newStop:proposal,initialNetRiskUsdt:p.initialRisk});
 };
 for(let i=1000;i<hours.length;i++){
  const time=hours[i]!.timestamp,today=Math.floor(time/86400000);if(today!==day){day=today;dayStart=equity;}const had=active!==undefined,candidates=byHour.get(time)??[];
  if(had){for(const _ of candidates)reject('position_occupied');const bar=data.instruments.find(d=>d.symbol===active!.symbol)!.hours[i]!;
   if(bar.low<=active!.stop||bar.high>=active!.target||bar.high>=active!.activationPrice){const minutes=map.get(active!.symbol+':'+time);if(!minutes)return need(active!.symbol,time);for(const m of minutes){processMinute(m);if(!active||halted)break;}}
  }
  if(!had&&!halted){for(let k=0;k<candidates.length;k++){
   const signal=candidates[k]!,rules=protocol.rules[signal.symbol];if(cash<=dayStart*.97||cash<=peak*.9){reject('portfolio_risk_halt');continue;}
   if(closed.length>=3&&closed.slice(-3).every(t=>t.netPnlUsdt<0)&&time<closed.at(-1)!.exitTimestamp+3600000+3600000){reject('loss_cooldown');continue;}
   const budget=positionSize({limits:protocol.riskLimits,equity:cash,free:cash,exposure:0,altExposure:0,symbolExposure:0,altcoin:signal.symbol!=='BTC/USDT',ceiling:10,stopRate:1-signal.stop/signal.limit,fee:Math.max(s.makerRate,s.takerRate),slippage:exitFriction(s),liquidity:1000});if(budget<=0){reject('risk_size');continue;}
   const qty=quantizeQuantityDown(budget,signal.limit,rules.quantityStep).quantity;if(qty<rules.minimumQuantity){reject('minimum_quantity');continue;}
   const p=new SwingV2Position(signal.symbol,signal.limit,signal.stop,qty,time,rules,s),netQty=swingSellable(qty,s.makerRate,rules.quantityStep);if(netQty<rules.minimumQuantity){reject('minimum_net_quantity');continue;}
   const q=swingLevels(qty*signal.limit,netQty,signal.limit,signal.stop,rules,s);if(q.risk<=0||q.risk>cash*.01){reject('stop_risk');continue;}if(q.grossTargetRate<.02){reject('target_amplitude');continue;}
   const minutes=map.get(signal.symbol+':'+time);if(!minutes)return need(signal.symbol,time);if(signal.limit>=minutes[0]!.open*(1+s.spreadRate/2)){reject('post_only_cross_proxy');continue;}
   active=p;activeSignal=signal;orders.push({id:p.buy.id,symbol:signal.symbol,placedAt:time,expiresAt:time+3600000,limit:signal.limit,initialStop:signal.stop,quantity:qty,projectedTarget:q.target,projectedNetRiskUsdt:q.risk,projectedNetRR:q.netRewardRisk,initialReserveUsdt:p.buy.reservedUsdt});for(let n=k+1;n<candidates.length;n++)reject('portfolio_priority');
   for(const m of minutes){processMinute(m);if(halted||!active)break;}p.expire(time+3600000);events.push({type:'buy_order_terminal',id:p.buy.id,status:p.buy.status,filledQuantity:p.buy.filledQuantity,reservedUsdt:p.buy.reservedUsdt});
   if(active&&p.buy.receivedBase===0){active=undefined;activeSignal=undefined;firstFill=0;}break;
  }}
  if(active){const bar=data.instruments.find(d=>d.symbol===active!.symbol)!.hours[i]!;
   if(!halted&&!active.tpResting&&active.remaining>0)active.postTarget(bar.close,time+3600000);
   equity=cash+active.remaining*bar.close*(1-s.takerRate)*(1-exitFriction(s));
  }else equity=cash;
  marks.push(equity);peak=Math.max(peak,equity);dd=Math.max(dd,peak-equity);ddPct=Math.max(ddPct,100*(peak-equity)/peak);if(halted)break;
 }
 const size=window.days*24/3,blocks=[0,1,2].map(b=>{const start=1000+b*size,end=start+size,before=marks[b*size-1]??17,after=marks[(b+1)*size-1],trades=closed.filter(t=>t.exitTimestamp>=hours[start]!.timestamp&&t.exitTimestamp<hours[end-1]!.timestamp+3600000);return {name:`D${b*window.days/3+1}-D${(b+1)*window.days/3}`,complete:after!==undefined,netReturnUsdt:after===undefined?null:after-before,...metrics(trades)};});
 return {status:halted?'blocked_unprotectable_inventory':'modeled_replay_complete',scenario:s.name,...metrics(closed),netReturnUsdt:equity-17,finalEquityUsdt:equity,maxDrawdownUsdt:dd,maxDrawdownPercent:ddPct,recoveryFactor:dd>0?(equity-17)/dd:null,blocks,bySymbol:data.instruments.map(d=>({symbol:d.symbol,...metrics(closed.filter(t=>t.symbol===d.symbol))})),ordersPlaced:orders.length,ordersWithFills:orders.filter(o=>events.some(e=>e.type==='buy_fill'&&e.id===o.id)).length,closedMakerTargets:closed.filter(t=>t.reason==='MAKER_TARGET').length,closedTakerStops:closed.filter(t=>t.reason!=='MAKER_TARGET').length,feesUsdt:sum(closed.map(t=>t.feesUsdt))+(active?.fees??0),modeledBufferUsdt:sum(closed.map(t=>t.modeledBufferUsdt))+(active?.bufferCost??0),rejected:rejects,openPosition:active?{symbol:active.symbol,remaining:active.remaining,netBaseReceived:active.buy.receivedBase,stop:active.stop,target:active.target,protectionActivated:active.protected}:null,orders,events,closedTradeLedger:closed,ordersSent:0,realMoneyApproved:false};
}
export function screenSwingV2(runs:any[]){
 const checks=runs.map((r,i)=>{const pf=r.profitFactorKind==='unbounded'||r.profitFactor!==null&&(i===0?r.profitFactor>1.25:r.profitFactor>=1);return {scenario:r.scenario,complete:r.status==='modeled_replay_complete',sample:r.closedTrades>=30,pf,net:i===0?r.netReturnUsdt>0&&r.realizedPnlUsdt>0:r.netReturnUsdt>=0&&r.realizedPnlUsdt>=0,ev:i===0?r.expectancyUsdt>0:r.expectancyUsdt!==null&&r.expectancyUsdt>=0,blocks:Array.isArray(r.blocks)&&r.blocks.length===3&&r.blocks.every((b:any)=>b.complete)&&r.blocks.filter((b:any)=>b.netReturnUsdt>0&&b.realizedPnlUsdt>0).length>=2,drawdown:r.maxDrawdownPercent<10,withoutTop3:r.realizedPnlWithoutTop3Usdt>0};});
 return {checks,passed:checks.length===2&&checks[0]!.scenario==='maker-target-standard'&&checks[1]!.scenario==='maker-target-adverse'&&checks.every(c=>c.complete&&c.sample&&c.pf&&c.net&&c.ev&&c.blocks&&c.drawdown&&c.withoutTop3)};
}
