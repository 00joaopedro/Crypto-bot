import { Precise } from 'ccxt';
import { z } from 'zod';
import { HYBRID_WATCHLIST } from './hybrid-research-signals.js';
import { positionSize,positionSizingSchema } from './position-sizing.js';
import { quantizeQuantityDown } from './decimal-quantity.js';
const positive=z.number().finite().positive(),nonnegative=z.number().finite().nonnegative();
export const spotEntryProposalSchema=z.object({symbol:z.string(),environment:z.enum(['real','demo']),entryStyle:z.enum(['taker','post_only']),bid:positive,ask:positive,bookObservedAtUtc:z.iso.datetime(),stopPrice:positive,targetPrice:positive,lotCeilingUsdt:positive.max(10),minimumNetRewardRisk:positive,minimumNetGainCostMultiple:nonnegative,riskLimits:positionSizingSchema,exposureUsdt:nonnegative,altExposureUsdt:nonnegative,symbolExposureUsdt:nonnegative,openPositions:z.number().int().nonnegative(),pendingOrders:z.number().int().nonnegative(),accountReconciled:z.boolean(),slippageRate:nonnegative.lt(1),maximumSpreadRate:nonnegative.lt(1),availableDepthUsdt:nonnegative,verifiedMinimumNotionalUsdt:positive.nullable()}).strict();
export type SpotRules={symbol:string;minimumQuantity:number;quantityStep:number;priceTick:number;minimumNotionalUsdt:null;observedAtUtc:string};
const parsePositive=(v:unknown)=>typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
/** Separate current rule cache: never rewrites frozen historical constraints. */
export class SpotInstrumentCache{
 private rows=new Map<string,SpotRules>();private observed=0;
 constructor(private readonly ttlMs=3600000){if(!Number.isFinite(ttlMs)||ttlMs<=0)throw new Error('Finite instrument cache TTL required');}
 update(raw:unknown,now=Date.now()){
  if(!Array.isArray(raw)||!Number.isFinite(now)||now<0)throw new Error('Instrument list required');
  const next=new Map<string,SpotRules>(),seen=new Set<string>();
  for(const row of raw){if(!row||typeof row!=='object')continue;const r=row as Record<string,unknown>,symbol=typeof r.instId==='string'?r.instId.replace('-','/'):'';
   if(!HYBRID_WATCHLIST.includes(symbol))continue;
   if(seen.has(symbol)){next.delete(symbol);continue;}seen.add(symbol);
   const min=parsePositive(r.minSz),step=parsePositive(r.lotSz),tick=parsePositive(r.tickSz);
   if(r.instType!=='SPOT'||r.quoteCcy!=='USDT'||r.state!=='live'||min===null||step===null||tick===null)continue;
   next.set(symbol,Object.freeze({symbol,minimumQuantity:min,quantityStep:step,priceTick:tick,minimumNotionalUsdt:null,observedAtUtc:new Date(now).toISOString()}));
  }this.rows=next;this.observed=now;
 }
 get(symbol:string,now=Date.now()):SpotRules|null{return !Number.isFinite(now)||now<this.observed||now-this.observed>=this.ttlMs?null:this.rows.get(symbol)??null;}
}
const snapshotSchema=z.object({status:z.literal('read_only_account_terms_snapshot'),environment:z.enum(['real','demo']),capturedAtUtc:z.iso.datetime(),entryFeeCurrency:z.enum(['base','quote']).nullable(),balance:z.object({usableCashStatus:z.string(),availableUsdt:nonnegative.nullable(),cashUsdt:nonnegative.nullable(),liabilityUsdt:nonnegative.nullable()}),terms:z.array(z.object({symbol:z.string(),instrumentStatus:z.string(),minimumQuantity:positive.nullable(),quantityStep:positive.nullable(),priceTick:positive.nullable(),takerFeeRate:nonnegative.lt(.1).nullable(),makerFeeRate:nonnegative.lt(.1).nullable().optional()}))});
/** Pure preview only. Caller observations are not exchange authorization, fills or approval for real funds. */
export function previewSpotEntry(rawSnapshot:unknown,rawProposal:unknown,now=Date.now()){
 const s=snapshotSchema.parse(rawSnapshot),p=spotEntryProposalSchema.parse(rawProposal);
 const blocked=(reason:string)=>({status:'blocked' as const,reason,ordersSent:0,orderSubmissionApproved:false,realMoneyApproved:false});
 if(!Number.isFinite(now)||!HYBRID_WATCHLIST.includes(p.symbol))return blocked('instrument_not_in_watchlist');
 if(s.environment!==p.environment)return blocked('account_environment_mismatch');
 const age=now-Date.parse(s.capturedAtUtc),bookAge=now-Date.parse(p.bookObservedAtUtc);
 if(age<0||age>60000||bookAge<0||bookAge>5000)return blocked('stale_account_or_book');
 if(s.balance.usableCashStatus!=='spot_cash_observed'||s.balance.liabilityUsdt!==0||s.balance.availableUsdt===null||s.balance.cashUsdt===null)return blocked('spendable_cash_unconfirmed');
 if(!p.accountReconciled)return blocked('account_not_reconciled');
 if(p.openPositions!==0||p.pendingOrders!==0)return blocked('position_or_order_pending');
 const rows=s.terms.filter(t=>t.symbol===p.symbol),t=rows.length===1?rows[0]:undefined;
 if(!t||t.instrumentStatus!=='live_spot_rules_observed'||t.minimumQuantity===null||t.quantityStep===null||t.priceTick===null)return blocked('instrument_rules_unconfirmed');
 const entryFee=p.entryStyle==='post_only'?t.makerFeeRate:t.takerFeeRate,exitFee=t.takerFeeRate;
 if(entryFee===null||entryFee===undefined||exitFee===null||s.entryFeeCurrency===null)return blocked('fee_or_currency_unconfirmed');
 if(p.ask<p.bid||(p.ask-p.bid)/p.ask>p.maximumSpreadRate)return blocked('book_or_spread_invalid');
 const spreadRate=(p.ask-p.bid)/p.ask,exitSlippage=1-(1-p.slippageRate)*(1-spreadRate/2);
 const step=t.quantityStep,tick=t.priceTick,entryPrice=p.entryStyle==='post_only'?quantizeQuantityDown(p.bid,1,tick).quantity:p.ask*(1+p.slippageRate);
 if(entryPrice<=0||(p.entryStyle==='post_only'&&entryPrice>=p.ask))return blocked('entry_price_invalid');
 const stop=quantizeQuantityDown(p.stopPrice,1,tick).quantity,target=quantizeQuantityDown(p.targetPrice,1,tick).quantity;
 if(!(stop>0&&stop<entryPrice&&target>entryPrice))return blocked('exit_levels_invalid');
 const equity=Math.min(17,s.balance.availableUsdt,s.balance.cashUsdt);
 const budget=positionSize({limits:p.riskLimits,equity,free:equity,exposure:p.exposureUsdt,altExposure:p.altExposureUsdt,symbolExposure:p.symbolExposureUsdt,altcoin:p.symbol!=='BTC/USDT',ceiling:p.lotCeilingUsdt,stopRate:1-stop/entryPrice,fee:Math.max(entryFee,exitFee),slippage:exitSlippage,liquidity:p.availableDepthUsdt});
 if(budget<=0)return blocked('risk_cap_cash_or_liquidity');
 const order=quantizeQuantityDown(budget,entryPrice,step),cost=order.notional*(s.entryFeeCurrency==='quote'?1+entryFee:1);
 const netQuantity=s.entryFeeCurrency==='base'?Number(new Precise(String(order.quantity)).mul(new Precise('1').sub(new Precise(String(entryFee)))).toString()):order.quantity;
 const sellable=netQuantity>0?quantizeQuantityDown(netQuantity,1,step).quantity:0;
 if(order.quantity<t.minimumQuantity||sellable<t.minimumQuantity||sellable<=0)return blocked('minimum_quantity_after_fee');
 const fixedMinimum=p.verifiedMinimumNotionalUsdt;
 if(fixedMinimum!==null&&(order.notional<fixedMinimum||sellable*stop<fixedMinimum))return blocked('minimum_notional');
 if(cost>equity)return blocked('cash_after_entry_fee');
 const proceeds=(price:number)=>sellable*price*(1-exitSlippage)*(1-exitFee),netGain=proceeds(target)-cost,loss=cost-proceeds(stop),fees=order.notional*entryFee+sellable*target*(1-exitSlippage)*exitFee;
 // Slippage is embedded in entry/exit prices; this budget comparison does not debit it twice.
 const executionCostEstimate=fees+order.quantity*Math.max(0,entryPrice-p.bid)+sellable*target*exitSlippage;
 if(netGain<=0||loss<=0)return blocked('target_does_not_cover_costs');
 if(loss>equity*p.riskLimits.riskPerTrade)return blocked('rounded_stop_risk_exceeded');
 if(netGain/loss<p.minimumNetRewardRisk)return blocked('net_reward_risk');
 if(netGain<executionCostEstimate*p.minimumNetGainCostMultiple)return blocked('net_gain_cost_margin');
 return {status:fixedMinimum===null?'limits_pending':'structural_preview_passed',reason:fixedMinimum===null?'fixed_notional_minimum_unconfirmed':'provided_limits_satisfied',symbol:p.symbol,environment:p.environment,entryStyle:p.entryStyle,entryPrice,stopPrice:stop,targetPrice:target,quantity:order.quantity,sellableQuantity:sellable,dustQuantity:netQuantity-sellable,cashCostUsdt:cost,derivedQuantityMinimumNotionalUsdt:t.minimumQuantity*entryPrice,netGainUsdt:netGain,estimatedStopLossUsdt:loss,netRewardRisk:netGain/loss,modeledExecutionCostUsdt:executionCostEstimate,entryFeeRate:entryFee,exitFeeRate:exitFee,ordersSent:0,orderSubmissionApproved:false,realMoneyApproved:false,limitations:['Caller-provided book, exposure and verified-notional values require independent operational verification.','Post-only quote is not a guaranteed fill or actual maker fee. Stop slippage/gaps can exceed this model.','This preview does not establish liquidity/depth or account-level instrument permission and cannot authorize an order.']};
}
