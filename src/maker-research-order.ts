import { Precise } from 'ccxt';
import { quantizeQuantityDown } from './decimal-quantity.js';
export type MakerRules={minimumQuantity:number;quantityStep:number;priceTick:number};
/** Pure research ledger. No exchange transport, authorization, persistence or native-protection claim. */
export class ResearchMakerOrder{
 readonly fills=new Map<string,{quantity:number;timestamp:number}>();
 filledQuantity=0;spentUsdt=0;receivedBase=0;buyFeesUsdt=0;
 status:'live'|'partially_filled'|'filled'|'canceled'='live';
 closed=false;
 constructor(readonly id:string,readonly limit:number,readonly requestedQuantity:number,readonly placedAt:number,readonly expiresAt:number,readonly makerRate:number,readonly rules:MakerRules){
  if(!id||![limit,requestedQuantity,rules.minimumQuantity,rules.quantityStep,rules.priceTick].every(v=>Number.isFinite(v)&&v>0)||!Number.isSafeInteger(placedAt)||placedAt<0||!Number.isSafeInteger(expiresAt)||expiresAt<=placedAt||!Number.isFinite(makerRate)||makerRate<0||makerRate>=1)throw new Error('Invalid maker research order');
  if(requestedQuantity<rules.minimumQuantity||quantizeQuantityDown(requestedQuantity,1,rules.quantityStep).quantity!==requestedQuantity||quantizeQuantityDown(limit,1,rules.priceTick).quantity!==limit)throw new Error('Invalid maker quantity/price increment');
 }
 get remainingQuantity(){return Math.max(0,Number(new Precise(String(this.requestedQuantity)).sub(new Precise(String(this.filledQuantity))).toString()));}
 get reservedUsdt(){return this.status==='live'||this.status==='partially_filled'?this.remainingQuantity*this.limit:0;}
 get sellableQuantity(){return this.receivedBase>0?quantizeQuantityDown(this.receivedBase,1,this.rules.quantityStep).quantity:0;}
 get unprotectablePartial(){return this.receivedBase>0&&this.sellableQuantity<this.rules.minimumQuantity;}
 fill(id:string,quantity:number,timestamp:number){
  const existing=this.fills.get(id);
  if(existing){if(existing.quantity!==quantity||existing.timestamp!==timestamp)throw new Error('Conflicting duplicate fill');return false;}
  if(!id||!Number.isSafeInteger(timestamp)||timestamp<this.placedAt||timestamp>=this.expiresAt||!Number.isFinite(quantity)||quantity<=0||quantizeQuantityDown(quantity,1,this.rules.quantityStep).quantity!==quantity||this.status==='filled'||this.status==='canceled'||quantity>this.remainingQuantity)throw new Error('Invalid or late maker fill');
  this.fills.set(id,{quantity,timestamp});
  this.filledQuantity=Number(new Precise(String(this.filledQuantity)).add(new Precise(String(quantity))).toString());
  const cost=quantity*this.limit;this.spentUsdt+=cost;this.buyFeesUsdt+=cost*this.makerRate;
  this.receivedBase=Number(new Precise(String(this.receivedBase)).add(new Precise(String(quantity)).mul(new Precise('1').sub(new Precise(String(this.makerRate))))).toString());
  this.status=this.filledQuantity===this.requestedQuantity?'filled':'partially_filled';return true;
 }
 cancel(){if(this.status==='live'||this.status==='partially_filled')this.status='canceled';}
 expire(now:number){if(!Number.isSafeInteger(now)||now<this.placedAt)throw new Error('Invalid maker clock');if(now>=this.expiresAt)this.cancel();}
 /** Limit-price sale at a modelled taker fill. Fees are not subtracted twice; unsold dust is explicitly written off. */
 close(exitReference:number,takerRate:number,exitFriction:number){
  if(this.closed||![exitReference,takerRate,exitFriction].every(Number.isFinite)||exitReference<=0||takerRate<0||takerRate>=1||exitFriction<0||exitFriction>=1||this.sellableQuantity<this.rules.minimumQuantity)throw new Error('Unprotectable or invalid research close');
  this.closed=true;this.cancel();const quantity=this.sellableQuantity,exitPrice=exitReference*(1-exitFriction),exitFee=quantity*exitPrice*takerRate,proceeds=quantity*exitPrice-exitFee;
  return {quantity,exitPrice,proceedsUsdt:proceeds,feesUsdt:this.buyFeesUsdt+exitFee,netPnlUsdt:proceeds-this.spentUsdt,dustQuantity:this.receivedBase-quantity};
 }
}
