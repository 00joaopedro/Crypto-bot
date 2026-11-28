import { SwingV2Position,exitFriction,type SwingCosts } from './swing-v2-ledger.js';
import { ceilTick,floorTick } from './swing-v2-signals.js';
import type { MakerRules } from './maker-research-order.js';
export class BreakoutV2Position extends SwingV2Position{
 trailingArmed=false;trailingUpdated=false;highestClosedHigh=0;
 constructor(symbol:string,entry:number,stop:number,quantity:number,time:number,rules:MakerRules,costs:SwingCosts){super(symbol,entry,stop,quantity,time,rules,costs,{targetR:3,ttlHours:4,protectAtR:1.2,floorR:.2});}
 private netAt(close:number){return this.proceeds+this.remaining*close*(1-this.costs.takerRate)*(1-exitFriction(this.costs))-this.buy.spentUsdt;}
 stageAtMinuteClose(close:number){const old=this.stop,protection=super.protectAtClose(close);let armed=false;
  if(!this.closed&&!this.unprotectable&&this.remaining>0&&this.initialRisk>0&&!this.trailingArmed&&this.netAt(close)>=2*this.initialRisk){this.trailingArmed=true;this.buy.cancel();armed=true;}
  return {old,protection,armed};
 }
 override get activationPrice(){if(this.remaining<=0||this.initialRisk<=0||this.trailingArmed)return Infinity;const trigger=this.protected?2:1.2;return (this.buy.spentUsdt+trigger*this.initialRisk-this.proceeds)/(this.remaining*(1-this.costs.takerRate)*(1-exitFriction(this.costs)));}
 updateClosedFourHour(high:number,atr:number,close:number){
  if(![high,atr,close].every(v=>Number.isFinite(v)&&v>0)||this.closed||this.unprotectable||this.remaining<=0)return null;
  this.highestClosedHigh=Math.max(this.highestClosedHigh,high);if(!this.trailingArmed)return null;
  const multiplier=(1-this.costs.takerRate)*(1-exitFriction(this.costs)),floor=ceilTick((this.buy.spentUsdt+.2*this.initialRisk-this.proceeds)/(this.remaining*multiplier),this.rules.priceTick),proposal=Math.max(floor,floorTick(this.highestClosedHigh-.8*atr,this.rules.priceTick));
  if(proposal<=this.stop||proposal>=close)return null;this.buy.cancel();this.stop=proposal;this.trailingUpdated=true;return proposal;
 }
}
