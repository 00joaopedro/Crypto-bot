import { Precise } from 'ccxt';
import { ResearchMakerOrder,type MakerRules } from './maker-research-order.js';
import { quantizeQuantityDown } from './decimal-quantity.js';
import { ceilTick } from './swing-v2-signals.js';
export type SwingCosts={name:string;makerRate:number;takerRate:number;slippageRate:number;spreadRate:number;participationRate:number;penetrationTicks:number};
export const exitFriction=(s:SwingCosts)=>(1+s.slippageRate)*(1+s.spreadRate/2)-1;
export const swingSellable=(quantity:number,fee:number,step:number)=>quantizeQuantityDown(Number(new Precise(String(quantity)).mul(new Precise('1').sub(new Precise(String(fee)))).toString()),1,step).quantity;
export function swingLevels(cost:number,quantity:number,entry:number,stop:number,rules:MakerRules,s:SwingCosts){
 const f=exitFriction(s),risk=cost-quantity*stop*(1-s.takerRate)*(1-f),buffer=cost*f;
 // A resting sell limit cannot execute below its limit. Uncertainty buffer is a separate modeled reserve, not an OKX fee.
 const target=ceilTick((cost+1.6*risk+buffer)/(quantity*(1-s.makerRate)),rules.priceTick),netGain=quantity*target*(1-s.makerRate)-cost-buffer;
 return {risk,target,netGain,buffer,grossTargetRate:target/entry-1,netRewardRisk:risk>0?netGain/risk:null};
}
export class SwingV2Position{
 readonly buy:ResearchMakerOrder;initialRisk=0;target=0;stop:number;remaining=0;initialSellable=0;proceeds=0;sellFees=0;bufferCost=0;closed=false;protected=false;tpResting=false;tpFrom=Infinity;
 readonly exitFills=new Map<string,{quantity:number;price:number;role:string}>();
 constructor(readonly symbol:string,readonly entry:number,readonly initialStop:number,quantity:number,readonly placedAt:number,readonly rules:MakerRules,readonly costs:SwingCosts){if(!Number.isFinite(initialStop)||initialStop<=0||initialStop>=entry)throw new Error('Swing stop must be below entry');this.stop=initialStop;this.buy=new ResearchMakerOrder(symbol+':'+placedAt,entry,quantity,placedAt,placedAt+3600000,costs.makerRate,rules);}
 get unprotectable(){return !this.closed&&this.buy.receivedBase>0&&this.remaining<this.rules.minimumQuantity;}
 buyFill(id:string,qty:number,time:number){const old=this.buy.fills.get(id);if(old){if(old.quantity!==qty||old.timestamp!==time)throw new Error('Conflicting swing buy fill');return false;}if(this.closed||this.proceeds>0)throw new Error('Cannot grow an exiting swing position');const accepted=this.buy.fill(id,qty,time);if(!accepted)return false;this.remaining=this.buy.sellableQuantity;this.initialSellable=this.remaining;
  if(this.remaining>=this.rules.minimumQuantity){const q=swingLevels(this.buy.spentUsdt,this.remaining,this.entry,this.initialStop,this.rules,this.costs);this.initialRisk=q.risk;this.target=q.target;}this.tpResting=false;this.tpFrom=Infinity;return true;}
 expire(time:number){this.buy.expire(time);}
 postTarget(close:number,time:number){if(this.closed||this.unprotectable||this.remaining<=0)return false;if(this.target<=close*(1-this.costs.spreadRate/2))return false;this.tpResting=true;this.tpFrom=time;return true;}
 sellFill(id:string,quantity:number,price:number,role:'maker'|'taker'){
  const old=this.exitFills.get(id);if(old){if(old.quantity!==quantity||old.price!==price||old.role!==role)throw new Error('Conflicting swing sell fill');return null;}
  if(this.closed||!id||!['maker','taker'].includes(role)||![quantity,price].every(v=>Number.isFinite(v)&&v>0)||quantity>this.remaining||quantizeQuantityDown(quantity,1,this.rules.quantityStep).quantity!==quantity||role==='taker'&&quantity<this.rules.minimumQuantity)throw new Error('Invalid swing sell fill');
  if(role==='maker'&&(!this.tpResting||price<this.target))throw new Error('Maker target must rest and cannot execute below limit');
  this.buy.cancel();this.exitFills.set(id,{quantity,price,role});const fee=quantity*price*(role==='maker'?this.costs.makerRate:this.costs.takerRate),reserve=role==='maker'?this.buy.spentUsdt*exitFriction(this.costs)*quantity/this.initialSellable:0,net=quantity*price-fee-reserve;
  this.remaining=Number(new Precise(String(this.remaining)).sub(new Precise(String(quantity))).toString());this.proceeds+=net;this.sellFees+=fee;this.bufferCost+=reserve;this.closed=this.remaining===0;if(this.closed)this.tpResting=false;return {net,fee,reserve,quantity,price,role};
 }
 protectAtClose(close:number){if(this.closed||this.unprotectable||this.remaining<=0||this.protected)return null;
  const multiplier=(1-this.costs.takerRate)*(1-exitFriction(this.costs)),netNow=this.proceeds+this.remaining*close*multiplier-this.buy.spentUsdt;
  if(netNow<this.initialRisk||this.initialRisk<=0)return null;
  const proposal=ceilTick((this.buy.spentUsdt+.15*this.initialRisk-this.proceeds)/(this.remaining*multiplier),this.rules.priceTick);
  if(proposal<=this.stop||proposal>=close)return null;this.buy.cancel();this.stop=proposal;this.protected=true;return proposal;
 }
 get activationPrice(){return this.protected||this.remaining<=0||this.initialRisk<=0?Infinity:(this.buy.spentUsdt+this.initialRisk-this.proceeds)/(this.remaining*(1-this.costs.takerRate)*(1-exitFriction(this.costs)));}
 get fees(){return this.buy.buyFeesUsdt+this.sellFees;}
 get netPnl(){return this.proceeds-this.buy.spentUsdt;}
 get dust(){return Math.max(0,this.buy.receivedBase-this.initialSellable);}
}
