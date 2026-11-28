import { z } from 'zod';
import { comparisonSchema, comparisonSlippage, scenarioCosts, type ComparisonOptions } from './strategy-comparison.js';
import { quantizeQuantityDown } from './decimal-quantity.js';
import { positionSizingSchema, type PositionSizingLimits } from './position-sizing.js';
import type { HybridInstrument } from './hybrid-research-replay.js';

const positive = z.number().finite().positive();
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const entrySchema = z.object({symbol:z.string(),strategy_mode:z.string(),decisionTimestamp:timestamp,entryTimestamp:timestamp,notionalUsdt:positive,stopPrice:positive,targetPrice:positive});
const tradeSchema = z.object({symbol:z.string(),strategy_mode:z.string(),entryTimestamp:timestamp,exitTimestamp:timestamp,entryPrice:positive,exitPrice:positive,quantity:positive,feesUsdt:z.number().finite().nonnegative(),netPnlUsdt:z.number().finite(),reason:z.string(),holdingCandles:z.number().int().positive()});
export type OpportunityEntry = z.infer<typeof entrySchema>;
export type OpportunityTrade = z.infer<typeof tradeSchema>;
const sum = (v:number[]) => v.reduce((a,b)=>a+b,0);
const dist = (v:number[]) => {const a=[...v].sort((x,y)=>x-y);return {samples:a.length,mean:a.length?sum(a)/a.length:null,median:a.length?a[Math.floor((a.length-1)/2)]!:null};};
const close = (a:number,b:number) => Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));

/** Fixed observed/modelled path attribution. Never reruns a strategy with cheaper fees or selects parameters. */
export function diagnoseOpportunities(input:{entries:unknown;trades:unknown;instruments:HybridInstrument[];scenario:ComparisonOptions['scenarios'][number];intervalMs:900000|3600000}){
 const entries=z.array(entrySchema).parse(input.entries),trades=z.array(tradeSchema).parse(input.trades),scenario=comparisonSchema.shape.scenarios.element.parse(input.scenario);
 if(![900000,3600000].includes(input.intervalMs))throw new Error('Explicit supported candle interval required');
 const instruments=new Map(input.instruments.map(d=>[d.symbol,d]));
 if(instruments.size!==input.instruments.length)throw new Error('Duplicate diagnostic instrument');
 const clocks=new Map<string,Map<number,number>>();
 for(const d of input.instruments){
  for(let i=0;i<d.candles15m.length;i++){const c=d.candles15m[i]!;
   if(![c.timestamp,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)||!Number.isSafeInteger(c.timestamp)||c.timestamp<0||c.timestamp%input.intervalMs||Math.min(c.open,c.close,c.low)<=0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.volume<0||(i>0&&c.timestamp-d.candles15m[i-1]!.timestamp!==input.intervalMs))throw new Error('Invalid or non-contiguous diagnostic candles');
  }
  clocks.set(d.symbol,new Map(d.candles15m.map((c,i)=>[c.timestamp,i])));
 }
 const key=(t:{symbol:string;entryTimestamp:number})=>`${t.symbol}:${t.entryTimestamp}`;
 const entryMap=new Map(entries.map(e=>[key(e),e]));
 if(entryMap.size!==entries.length)throw new Error('Duplicate diagnostic entry');
 const seen=new Set<string>();let lastExit=-1;
 const rows=[...trades].sort((a,b)=>a.entryTimestamp-b.entryTimestamp).map(t=>{
  if(seen.has(key(t)))throw new Error('Duplicate diagnostic trade');seen.add(key(t));
  const e=entryMap.get(key(t)),d=instruments.get(t.symbol),clock=clocks.get(t.symbol),start=clock?.get(t.entryTimestamp),end=clock?.get(t.exitTimestamp);
  if(!e||!d||start===undefined||end===undefined||end<start||e.strategy_mode!==t.strategy_mode||e.decisionTimestamp!==t.entryTimestamp-input.intervalMs||t.holdingCandles!==end-start+1)throw new Error('Entry/trade candle identity mismatch');
  if(t.entryTimestamp<=lastExit)throw new Error('Overlapping shared-portfolio trades');lastExit=t.exitTimestamp;
  const costs=scenarioCosts(scenario,t.symbol),slip=comparisonSlippage(costs),f=costs.feeRate,base=costs.entryFeeCurrency==='base';
  const n=e.notionalUsdt,q0=n/t.entryPrice,cash=n*(base?1:1+f),entryReference=d.candles15m[start]!.open,exitReference=t.exitPrice/(1-slip);
  if(!close(t.entryPrice,entryReference*(1+slip))||!close(t.quantity,q0*(base?1-f:1))||!close(t.feesUsdt,n*f+t.quantity*t.exitPrice*f)||!close(t.netPnlUsdt,t.quantity*t.exitPrice*(1-f)-cash))throw new Error('Ledger accounting differs from frozen cost model');
  const beforeFeesAtFixedFills=q0*(t.exitPrice-t.entryPrice),referencePathPnl=n*(exitReference/entryReference-1);
  const entryFriction=(n/entryReference-q0)*exitReference,exitFriction=q0*(exitReference-t.exitPrice),feeEffect=beforeFeesAtFixedFills-t.netPnlUsdt;
  if(!close(referencePathPnl-entryFriction-exitFriction-feeEffect,t.netPnlUsdt))throw new Error('Cost attribution identity failed');
  const breakEvenExit=cash/(t.quantity*(1-f)*(1-slip)),held=d.candles15m.slice(start,end);
  const extrema=(bars:typeof held)=>bars.length?{mfeRate:Math.max(0,...bars.map(c=>c.high/t.entryPrice-1)),maeRate:Math.max(0,...bars.map(c=>1-c.low/t.entryPrice)),highReachedModeledBreakEven:bars.some(c=>c.high>=breakEvenExit)}:null;
  const plannedGain=t.quantity*e.targetPrice*(1-slip)*(1-f)-cash,plannedLoss=cash-t.quantity*e.stopPrice*(1-slip)*(1-f);
  return {symbol:t.symbol,mode:t.strategy_mode,reason:t.reason,entryTimestamp:t.entryTimestamp,exitTimestamp:t.exitTimestamp,entryNotionalUsdt:n,netPnlUsdt:t.netPnlUsdt,
   recordedFeesUsdt:t.feesUsdt,addBackRecordedFeesUsdt:t.netPnlUsdt+t.feesUsdt,beforeFeesAtFixedFillsUsdt:beforeFeesAtFixedFills,referencePathPnlUsdt:referencePathPnl,
   entryFrictionUsdt:entryFriction,exitFrictionUsdt:exitFriction,feeEffectUsdt:feeEffect,baseFeeRevaluationUsdt:feeEffect-t.feesUsdt,
   breakEvenMoveFromFillRate:breakEvenExit/t.entryPrice-1,breakEvenMoveFromReferenceRate:breakEvenExit/entryReference-1,
   plannedNetRewardRisk:plannedLoss>0?plannedGain/plannedLoss:null,holdingMinutesUpperBound:t.holdingCandles*input.intervalMs/60000,
   entrySessionUtc:`${Math.floor(new Date(t.entryTimestamp).getUTCHours()/6)*6}`.padStart(2,'0')+'–'+`${Math.floor(new Date(t.entryTimestamp).getUTCHours()/6)*6+6}`.padStart(2,'0'),
   ownedExcursion:extrema(held),forward:[1,4,8].map(bars=>{const q=d.candles15m.slice(start,start+bars),complete=q.length===bars;return {bars,complete,includesExitOrLater:start+bars>end,excursion:complete?extrema(q):null,closeMoveRate:complete?q.at(-1)!.close/t.entryPrice-1:null};})};
 });
 const summary=(items:typeof rows)=>{
  const total=(k:'netPnlUsdt'|'recordedFeesUsdt'|'addBackRecordedFeesUsdt'|'beforeFeesAtFixedFillsUsdt'|'referencePathPnlUsdt'|'entryFrictionUsdt'|'exitFrictionUsdt'|'feeEffectUsdt'|'baseFeeRevaluationUsdt')=>sum(items.map(t=>t[k]));
  const gains=sum(items.map(t=>Math.max(0,t.netPnlUsdt))),losses=sum(items.map(t=>Math.max(0,-t.netPnlUsdt))),wins=items.filter(t=>t.netPnlUsdt>0),loss=items.filter(t=>t.netPnlUsdt<0),avgWin=wins.length?gains/wins.length:null,avgLoss=loss.length?losses/loss.length:null;
  return {trades:items.length,netPnlUsdt:total('netPnlUsdt'),recordedFeesUsdt:total('recordedFeesUsdt'),addBackRecordedFeesUsdt:total('addBackRecordedFeesUsdt'),beforeFeesAtFixedFillsUsdt:total('beforeFeesAtFixedFillsUsdt'),referencePathPnlUsdt:total('referencePathPnlUsdt'),entryFrictionUsdt:total('entryFrictionUsdt'),exitFrictionUsdt:total('exitFrictionUsdt'),feeEffectUsdt:total('feeEffectUsdt'),baseFeeRevaluationUsdt:total('baseFeeRevaluationUsdt'),profitFactor:losses?gains/losses:null,expectancyUsdt:items.length?total('netPnlUsdt')/items.length:null,winRate:wins.length&&items.length?wins.length/items.length:items.length?0:null,averageWinUsdt:avgWin,averageLossUsdt:avgLoss,breakEvenWinRate:avgWin!==null&&avgLoss!==null?avgLoss/(avgWin+avgLoss):null,
   feeTurnedLossesAtFixedFills:items.filter(t=>t.beforeFeesAtFixedFillsUsdt>=0&&t.netPnlUsdt<0).length,allFrictionTurnedLossesOnReferencePath:items.filter(t=>t.referencePathPnlUsdt>=0&&t.netPnlUsdt<0).length,
   notionalUsdt:dist(items.map(t=>t.entryNotionalUsdt)),holdingMinutesUpperBound:dist(items.map(t=>t.holdingMinutesUpperBound)),plannedNetRewardRisk:dist(items.flatMap(t=>t.plannedNetRewardRisk===null?[]:[t.plannedNetRewardRisk])),breakEvenMoveFromReferenceRate:dist(items.map(t=>t.breakEvenMoveFromReferenceRate)),
   ownedExcursionSamples:items.filter(t=>t.ownedExcursion!==null).length,mfeRate:dist(items.flatMap(t=>t.ownedExcursion?[t.ownedExcursion.mfeRate]:[])),maeRate:dist(items.flatMap(t=>t.ownedExcursion?[t.ownedExcursion.maeRate]:[])),ownedHighReachedModeledBreakEven:items.filter(t=>t.ownedExcursion?.highReachedModeledBreakEven).length,
   forward:[1,4,8].map(bars=>{const h=items.map(t=>t.forward.find(x=>x.bars===bars)!),a=h.filter(x=>x.complete);return {bars,minutes:bars*input.intervalMs/60000,completeSamples:a.length,missingSamples:h.length-a.length,includesExitOrLater:a.filter(x=>x.includesExitOrLater).length,mfeRate:dist(a.flatMap(x=>x.excursion?[x.excursion.mfeRate]:[])),closeMoveRate:dist(a.flatMap(x=>x.closeMoveRate===null?[]:[x.closeMoveRate])),highReachedModeledBreakEven:a.filter(x=>x.excursion?.highReachedModeledBreakEven).length};})};
 };
 const group=(key:(t:typeof rows[number])=>string)=>[...new Set(rows.map(key))].sort().map(k=>{
  const s=summary(rows.filter(t=>key(t)===k));
  return {key:k,trades:s.trades,netPnlUsdt:s.netPnlUsdt,recordedFeesUsdt:s.recordedFeesUsdt,referencePathPnlUsdt:s.referencePathPnlUsdt,profitFactor:s.profitFactor,expectancyUsdt:s.expectancyUsdt,mfeRate:s.mfeRate,maeRate:s.maeRate,ownedExcursionSamples:s.ownedExcursionSamples,ownedHighReachedModeledBreakEven:s.ownedHighReachedModeledBreakEven,holdingMinutesUpperBound:s.holdingMinutesUpperBound};
 });
 return {summary:summary(rows),byMode:group(t=>t.mode),byExit:group(t=>t.reason),bySymbol:group(t=>t.symbol),byEntrySessionUtc:group(t=>t.entrySessionUtc),rows};
}

const termSchema=z.object({symbol:z.string(),instrumentStatus:z.string(),minimumQuantity:positive.nullable(),quantityStep:positive.nullable(),priceTick:positive.nullable(),minimumNotionalUsdt:positive.nullable(),feeStatus:z.string(),takerFeeRate:z.number().finite().min(0).lt(.1).nullable(),makerFeeRate:z.number().finite().min(0).lt(.1).nullable().optional()});
const snapshotSchema=z.object({status:z.literal('read_only_account_terms_snapshot'),environment:z.enum(['real','demo']),capturedAtUtc:z.iso.datetime(),entryFeeCurrency:z.enum(['base','quote']).nullable(),balance:z.object({availableUsdt:z.number().finite().nonnegative().nullable(),cashUsdt:z.number().finite().nonnegative().nullable(),liabilityUsdt:z.number().finite().nonnegative().nullable(),usableCashStatus:z.string()}),terms:z.array(termSchema)});
/** Static, dated capacity only. Does not replace a fresh account/book/risk pre-order check. */
export function diagnoseBankCapacity(raw:unknown,instruments:HybridInstrument[],rawLimits:PositionSizingLimits,now:number){
 const snapshot=snapshotSchema.parse(raw),limits=positionSizingSchema.parse(rawLimits),terms=new Map(snapshot.terms.map(t=>[t.symbol,t]));
 if(!Number.isFinite(now)||snapshot.terms.length!==terms.size||new Set(instruments.map(d=>d.symbol)).size!==instruments.length||Date.parse(snapshot.capturedAtUtc)>now)throw new Error('Invalid account snapshot identity/time');
 const ageMs=now-Date.parse(snapshot.capturedAtUtc),fresh=ageMs<=60000;
 return {accountEnvironment:snapshot.environment,accountCapturedAtUtc:snapshot.capturedAtUtc,accountAgeMs:ageMs,accountFresh:fresh,plannedBankUsdt:17,cashConfirmed:snapshot.balance.usableCashStatus==='spot_cash_observed'&&snapshot.balance.liabilityUsdt===0&&snapshot.balance.availableUsdt!==null&&snapshot.balance.cashUsdt!==null,
  rows:snapshot.terms.map(t=>{
   const d=instruments.find(x=>x.symbol===t.symbol),bar=d?.candles15m.at(-1),cap=Math.min(10,17*limits.maxExposure,17*limits.maxSymbolExposure,...(t.symbol==='BTC/USDT'?[]:[17*limits.maxAltExposure]));
   const f=t.feeStatus==='account_pair_quote'?t.takerFeeRate:null;
   let conditionalQuantityPass:boolean|null=null,quantity:number|null=null,sellableQuantity:number|null=null,minimumQuantityNotionalUsdt:number|null=null;
   if(bar&&t.instrumentStatus==='live_spot_rules_observed'&&t.minimumQuantity!==null&&t.quantityStep!==null&&f!==null&&snapshot.entryFeeCurrency!==null){
    const order=quantizeQuantityDown(cap/(snapshot.entryFeeCurrency==='quote'?1+f:1),bar.close,t.quantityStep);quantity=order.quantity;
    sellableQuantity=quantizeQuantityDown(quantity*(snapshot.entryFeeCurrency==='base'?1-f:1),1,t.quantityStep).quantity;minimumQuantityNotionalUsdt=t.minimumQuantity*bar.close;
    conditionalQuantityPass=quantity>=t.minimumQuantity&&sellableQuantity>=t.minimumQuantity;
   }
   return {symbol:t.symbol,exposureCeilingUsdt:cap,priceReference:bar?{price:bar.close,candleTimestamp:bar.timestamp,source:'last_supplied_closed_candle_not_live_book'}:null,minimumQuantity:t.minimumQuantity,quantityStep:t.quantityStep,priceTick:t.priceTick,minimumQuantityNotionalUsdt,quantity,sellableQuantity,conditionalQuantityPass,takerQuoteRate:f,makerQuoteRate:t.makerFeeRate??null,minimumNotionalUsdt:t.minimumNotionalUsdt,
    liveTradingEligible:false,reason:conditionalQuantityPass===false?'quantity_minimum_exceeds_static_ceiling':'fresh_cash_fees_book_minimum_notional_and_risk_check_required'};
  }),ordersSent:0,realMoneyApproved:false};
}
