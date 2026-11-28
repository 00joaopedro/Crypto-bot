import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compressionSource } from '../dist/compression-retest.js';
import { makerPayoff } from '../dist/maker-pullback.js';
import { positionSize } from '../dist/position-sizing.js';
import { quantizeQuantityDown } from '../dist/decimal-quantity.js';
import { semanticHash } from '../dist/cost-experiments.js';
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const [sourcePath,minutePath,resultDir,outPath]=process.argv.slice(2);if(!sourcePath||!minutePath||!resultDir||!outPath||process.argv.length!==6)throw new Error('Usage: compression-retest-diagnosis <hour-source> <minute-source> <results-directory> <NEW-output.json>');
const data=json(sourcePath),micro=json(minutePath),summary=json(resultDir+'/summary.json'),ledger=json(resultDir+'/ledgers.json'),protocol=json('examples/compression-retest.plan.json'),{signals}=compressionSource(data,protocol);
if(summary.sourceDatasetSha256!==semanticHash(data)||summary.minuteSourceSha256!==semanticHash(micro)||summary.minuteSourceSha256!==ledger.minuteSourceSha256)throw new Error('Compression diagnostic source mismatch');
const dist=v=>{const a=[...v].sort((a,b)=>a-b);return {samples:a.length,min:a[0]??null,median:a.length?a[Math.floor((a.length-1)/2)]:null,max:a.at(-1)??null};};
const runs=protocol.scenarios.map(scenario=>{
 const friction=(1+scenario.slippageRate)*(1+scenario.spreadRate/2)-1,r=ledger.runs.find(r=>r.scenario===scenario.name),metrics=summary.runs.find(r=>r.scenario===scenario.name);if(!r||!metrics)throw new Error('Missing scenario ledger');
 const quotes=signals.map(s=>{
  const rules=protocol.rules[s.symbol],budget=positionSize({limits:protocol.riskLimits,equity:17,free:17,exposure:0,altExposure:0,symbolExposure:0,altcoin:s.symbol!=='BTC/USDT',ceiling:10,stopRate:1-s.stop/s.limit,fee:Math.max(scenario.makerRate,scenario.takerRate),slippage:friction,liquidity:1000});
  const quantity=budget>0?quantizeQuantityDown(budget,s.limit,rules.quantityStep).quantity:0,q=quantity>0?makerPayoff(quantity,s,scenario.makerRate,scenario.takerRate,friction,rules.quantityStep):null;
  return {...s,atInitialBankUsdt:17,quantity,netRewardRisk:q&&q.loss>0?q.gain/q.loss:null,netGainCostMultiple:q&&q.roundtrip>0?q.gain/q.roundtrip:null,quantityPass:q!==null&&quantity>=rules.minimumQuantity&&q.sellable>=rules.minimumQuantity,netRewardRiskPass:q!==null&&q.loss>0&&q.gain/q.loss>=1.5,netCostMarginPass:q!==null&&q.roundtrip>=0&&q.gain>=2*q.roundtrip};
 });
 const trades=r.closedTradeLedger.map(t=>{
  const entryHour=Math.floor(t.entryTimestamp/3600000)*3600000,entryMinutes=micro.windows.find(w=>w.symbol===t.symbol&&w.hour===entryHour)?.candles;if(!entryMinutes)throw new Error('Missing filled trade entry minutes');
  const first=entryMinutes.filter(c=>c.timestamp>t.entryTimestamp&&c.timestamp<t.exitTimestamp),later=data.instruments.find(d=>d.symbol===t.symbol).candles15m.filter(c=>c.timestamp>=entryHour+3600000&&c.timestamp+3600000<=t.exitTimestamp),owned=[...first,...later];
  const excursion=owned.length?{samples:owned.length,mfeRate:Math.max(0,...owned.map(c=>c.high/t.entryPrice-1)),maeRate:Math.max(0,...owned.map(c=>1-c.low/t.entryPrice))}:null;
  const q0=t.entryNotionalUsdt/t.entryPrice,reference=t.exitPrice/(1-friction),fixedFillBeforeFeeAndDustUsdt=q0*(t.exitPrice-t.entryPrice),referencePathPnlUsdt=q0*(reference-t.entryPrice),exitFrictionUsdt=q0*(reference-t.exitPrice),feeAndDustEffectUsdt=fixedFillBeforeFeeAndDustUsdt-t.netPnlUsdt;
  if(Math.abs(referencePathPnlUsdt-exitFrictionUsdt-feeAndDustEffectUsdt-t.netPnlUsdt)>1e-8||Math.abs(t.quantity*t.exitPrice*(1-scenario.takerRate)-t.entryNotionalUsdt-t.netPnlUsdt)>1e-8)throw new Error('Compression cost attribution mismatch');
  return {...t,ownedExcursion:excursion,entryMinuteAndExitBarExcluded:true,addBackRecordedFeesUsdt:t.netPnlUsdt+t.feesUsdt,fixedFillBeforeFeeAndDustUsdt,referencePathPnlUsdt,exitFrictionUsdt,feeAndDustEffectUsdt};
 });
 const terminals=r.events.filter(e=>e.type==='order_terminal'),updates=r.events.filter(e=>e.type==='trailing_stop_updated'),beforeTarget=r.orders.filter(o=>o.projectedNetRewardRisk>=2).length;
 return {scenario:scenario.name,startingBankQuotes:{candidates:quotes.length,netRewardRisk:dist(quotes.flatMap(q=>q.netRewardRisk===null?[]:[q.netRewardRisk])),independentRejections:{minimumQuantity:quotes.filter(q=>!q.quantityPass).length,netRewardRisk:quotes.filter(q=>!q.netRewardRiskPass).length,netCostMargin:quotes.filter(q=>!q.netCostMarginPass).length}},
  orderExecution:{ordersPlaced:r.orders.length,ordersWithFills:metrics.ordersWithFills,unfilledCanceled:terminals.filter(e=>e.status==='canceled'&&e.filledQuantity===0).length,partialCanceled:terminals.filter(e=>e.status==='canceled'&&e.filledQuantity>0).length,fillRate:metrics.ordersPlaced?metrics.ordersWithFills/metrics.ordersPlaced:null},
  trailing:{stopUpdates:updates.length,ordersWhoseTargetAllowsNet2RActivation:beforeTarget,ordersWhoseFixedTargetPrecedesNet2R:r.orders.length-beforeTarget,updates},quotes,trades};
});
writeFileSync(outPath,JSON.stringify({protocol:'compression-retest-diagnosis-v1',protocolFrozenCommit:summary.protocolFrozenCommit,sourceDatasetSha256:summary.sourceDatasetSha256,minuteSourceSha256:summary.minuteSourceSha256,ledgerFileSha256:createHash('sha256').update(readFileSync(resultDir+'/ledgers.json')).digest('hex'),runs,
 limitations:['Static starting-bank quotes are not another portfolio replay; rejection counts overlap. No parameters or pairs selected from this diagnosis.',
 'Maker fills, queue/participation and expiry are modeled, not native OKX evidence. Minute coverage does not authenticate actual execution.',
 'Owned excursions exclude entry minute and exit bar; later fully held hours and entry-hour fully held minutes have different granularity. MFE/MAE do not establish executable profit.',
 'Cost attribution holds the same selected trades, entry limit and exit references. Removing modeled friction/fees/dust is not a cheaper-cost strategy replay.',
 'Fixed gross3R target can precede net2R activation. No trailing stop updates does not by itself prove that no position ever met an activation threshold.'],ordersSent:0,realMoneyApproved:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'compression_diagnosis_complete',runs:runs.map(({quotes,trades,...r})=>({...r,trades}))}));
