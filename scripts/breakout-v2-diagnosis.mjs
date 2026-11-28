import fs from 'node:fs';
import path from 'node:path';
import {semanticHash} from '../dist/cost-experiments.js';
import {scanBreakoutV2} from '../dist/breakout-v2-signals.js';
import {exitFriction} from '../dist/swing-v2-ledger.js';
const [dataDir,resultsDir,output,...extra]=process.argv.slice(2);
if(!dataDir||!resultsDir||!output||extra.length)throw Error('Usage: node scripts/breakout-v2-diagnosis.mjs <source-directory> <results-directory> <NEW-output>');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),p=read('examples/breakout-v2.plan.json'),summary=read(path.join(resultsDir,'summary.json')),ledgers=read(path.join(resultsDir,'ledgers.json'));
const median=values=>{const a=values.toSorted((a,b)=>a-b);return !a.length?null:a.length%2?a[Math.floor(a.length/2)]:(a[a.length/2-1]+a[a.length/2])/2;};
const phases=summary.phases.map(phase=>{
 const data=read(path.join(dataDir,phase.name+'-hours.json')),micro=read(path.join(dataDir,phase.name+'-minutes.json'));
 if(semanticHash(data)!==phase.hoursSha256||semanticHash(micro)!==phase.minutesSha256)throw Error('Diagnosis source identity mismatch');
 const scan=scanBreakoutV2(data,p,phase.window);if(scan.signals.length!==phase.signalCount)throw Error('Diagnosis signal mismatch');
 const details=ledgers.phases.find(x=>x.name===phase.name);if(!details)throw Error('Missing ledger phase');
 const runs=details.runs.map(run=>{
  const costs=p.scenarios.find(c=>c.name===run.scenario);if(!costs)throw Error('Unknown frozen scenario');
  const trades=run.closedTradeLedger.map(t=>{
   const order=run.orders.find(o=>o.id===t.entryOrderId);if(!order)throw Error('Missing order');const buy=run.events.filter(e=>e.type==='buy_fill'&&e.id===order.id),q0=buy.reduce((a,e)=>a+e.quantity,0);
   const exits=run.events.filter(e=>['stop_fill','maker_target_fill'].includes(e.type)&&e.symbol===t.symbol&&e.timestamp>=t.entryTimestamp&&e.timestamp<=t.exitTimestamp);
   const cost=buy.reduce((a,e)=>a+e.quantity*e.price,0),baseFeeCost=cost*costs.makerRate,dustCost=t.dustQuantity*t.entryPrice;
   let gross=0,friction=0;for(const e of exits){const reference=e.role==='taker'?e.price/(1-exitFriction(costs)):e.price;gross+=e.quantity*(reference-t.entryPrice);friction+=e.quantity*(reference-e.price);}
   const reconciled=gross-baseFeeCost-dustCost-exits.reduce((a,e)=>a+e.fee+e.reserve,0)-friction;if(Math.abs(reconciled-t.netPnlUsdt)>1e-9||Math.abs(cost-t.entryNotionalUsdt)>1e-9||q0<=0)throw Error('Trade attribution does not reconcile');
   const hours=data.instruments.find(d=>d.symbol===t.symbol).hours,owned=[];
   // Include only candles wholly owned between fill minute and exit minute. Entry/exit minute extrema have unknown ordering.
   for(const h of hours){if(h.timestamp>t.exitTimestamp||h.timestamp+3600000<=t.entryTimestamp)continue;const m=micro.windows.find(w=>w.symbol===t.symbol&&w.hour===h.timestamp);
    if(m)owned.push(...m.candles.filter(c=>c.timestamp>t.entryTimestamp&&c.timestamp+60000<=t.exitTimestamp));else if(h.timestamp>t.entryTimestamp&&h.timestamp+3600000<=t.exitTimestamp)owned.push(h);
   }
   const mfe=owned.length?Math.max(0,...owned.map(c=>100*(c.high/t.entryPrice-1))):null,mae=owned.length?Math.max(0,...owned.map(c=>100*(1-c.low/t.entryPrice))):null;
   return {symbol:t.symbol,entryTimestamp:t.entryTimestamp,exitTimestamp:t.exitTimestamp,holdingMinutes:(t.exitTimestamp-t.entryTimestamp)/60000,reason:t.reason,netPnlUsdt:t.netPnlUsdt,grossPricePnlOnOwnedSellableQuantityUsdt:gross,baseBuyFeeCostUsdt:baseFeeCost,sellFeesUsdt:exits.reduce((a,e)=>a+e.fee,0),takerFrictionUsdt:friction,dustWriteoffAtEntryUsdt:dustCost,modeledMakerReserveUsdt:t.modeledBufferUsdt,reconciledNetPnlUsdt:reconciled,mfePercentOwnedBars:mfe,maePercentOwnedBars:mae,ownedBarCount:owned.length,protectionActivated:t.protectionActivated,trailingArmed:t.trailingArmed,trailingUpdated:t.trailingUpdated};
  });
  const total=k=>trades.reduce((s,t)=>s+t[k],0),unfilled=run.orders.filter(o=>!run.events.some(e=>e.type==='buy_fill'&&e.id===o.id)).length;
  return {scenario:run.scenario,ordersPlaced:run.orders.length,ttlMinutes:[...new Set(run.orders.map(o=>(o.expiresAt-o.placedAt)/60000))],firstFillDelaysMinutes:run.orders.flatMap(o=>{const fills=run.events.filter(e=>e.type==='buy_fill'&&e.id===o.id);return fills.length?[(Math.min(...fills.map(e=>e.timestamp))-o.placedAt)/60000]:[];}),ordersUnfilled:unfilled,fillRatePercent:run.orders.length?100*(run.orders.length-unfilled)/run.orders.length:null,projectedGrossTargetMedianPercent:median(run.orders.map(o=>100*(o.projectedTarget/o.limit-1))),projectedStopMedianPercent:median(run.orders.map(o=>100*(1-o.initialStop/o.limit))),projectedNetRRMin:run.orders.length?Math.min(...run.orders.map(o=>o.projectedNetRR)):null,projectedNetRRMax:run.orders.length?Math.max(...run.orders.map(o=>o.projectedNetRR)):null,protectionUpdates:run.events.filter(e=>e.type==='protection_updated').length,makerTargetFills:run.events.filter(e=>e.type==='maker_target_fill').length,trailingArmEvents:run.events.filter(e=>e.type==='trailing_armed').length,trailingUpdates:run.events.filter(e=>e.type==='trailing_updated').length,totalGrossPricePnlUsdt:total('grossPricePnlOnOwnedSellableQuantityUsdt'),totalBaseBuyFeeCostUsdt:total('baseBuyFeeCostUsdt'),totalSellFeesUsdt:total('sellFeesUsdt'),totalTakerFrictionUsdt:total('takerFrictionUsdt'),totalDustWriteoffUsdt:total('dustWriteoffAtEntryUsdt'),totalNetPnlUsdt:total('netPnlUsdt'),trades};
 });return {name:phase.name,hoursSha256:phase.hoursSha256,minutesSha256:phase.minutesSha256,funnel:phase.funnel,runs};
});
fs.writeFileSync(output,JSON.stringify({protocol:summary.protocol,protocolFrozenCommit:summary.protocolFrozenCommit,phases,limitations:['Diagnostic only: no parameter/period/universe selection or fresh source collection.','Gross price attribution uses the same fills and sellable inventory before fees/friction; it is not a zero-cost strategy replay.','Owned-bar MFE/MAE excludes entry and exit minutes and mixes whole1h/minute candles. It is partial opportunity evidence, not an executable counterfactual exit.','Standard and adverse recompute fee-aware quotes, quantities and posting proxies; they need not produce identical fills or a nested trade set.']},null,2)+'\n',{flag:'wx'});
