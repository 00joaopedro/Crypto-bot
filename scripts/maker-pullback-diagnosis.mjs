import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makerSource,makerPayoff } from '../dist/maker-pullback.js';
import { positionSize } from '../dist/position-sizing.js';
import { quantizeQuantityDown } from '../dist/decimal-quantity.js';
import { semanticHash } from '../dist/cost-experiments.js';
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const [sourcePath,minutePath,resultDir,outPath]=process.argv.slice(2);if(!sourcePath||!minutePath||!resultDir||!outPath||process.argv.length!==6)throw new Error('Usage: maker-pullback-diagnosis <hour-source> <minute-source> <results-directory> <NEW-output.json>');
const data=json(sourcePath),micro=json(minutePath),summary=json(resultDir+'/summary.json'),protocol=json('examples/maker-pullback.plan.json'),{signals}=makerSource(data,protocol);
if(summary.sourceDatasetSha256!==semanticHash(data)||summary.minuteSourceSha256!==semanticHash(micro))throw new Error('Diagnostic source mismatch');
const dist=values=>{const a=[...values].sort((a,b)=>a-b);return {samples:a.length,min:a[0]??null,median:a.length?a[Math.floor((a.length-1)/2)]:null,max:a.at(-1)??null};};
const runs=protocol.scenarios.map(scenario=>{
 const friction=(1+scenario.slippageRate)*(1+scenario.spreadRate/2)-1;
 const rows=signals.map(s=>{
  const rules=protocol.rules[s.symbol],budget=positionSize({limits:protocol.riskLimits,equity:17,free:17,exposure:0,altExposure:0,symbolExposure:0,altcoin:s.symbol!=='BTC/USDT',ceiling:10,stopRate:1-s.stop/s.limit,fee:Math.max(scenario.makerRate,scenario.takerRate),slippage:friction,liquidity:1000});
  const quantity=budget>0?quantizeQuantityDown(budget,s.limit,rules.quantityStep).quantity:0,q=quantity>0?makerPayoff(quantity,s,scenario.makerRate,scenario.takerRate,friction,rules.quantityStep):null;
  return {...s,atInitialBankUsdt:17,quantity,notionalUsdt:quantity*s.limit,grossStopRate:1-s.stop/s.limit,grossTargetRate:s.target/s.limit-1,netRewardRisk:q&&q.loss>0?q.gain/q.loss:null,netGainCostMultiple:q&&q.roundtrip>0?q.gain/q.roundtrip:null,quantityPass:q!==null&&quantity>=rules.minimumQuantity&&q.sellable>=rules.minimumQuantity,netRewardRiskPass:q!==null&&q.loss>0&&q.gain/q.loss>=1.5,netCostMarginPass:q!==null&&q.roundtrip>=0&&q.gain>=2*q.roundtrip};
 });
 return {scenario:scenario.name,candidates:rows.length,grossStopRate:dist(rows.map(r=>r.grossStopRate)),grossTargetRate:dist(rows.map(r=>r.grossTargetRate)),netRewardRisk:dist(rows.flatMap(r=>r.netRewardRisk===null?[]:[r.netRewardRisk])),netGainCostMultiple:dist(rows.flatMap(r=>r.netGainCostMultiple===null?[]:[r.netGainCostMultiple])),independentRejections:{minimumQuantity:rows.filter(r=>!r.quantityPass).length,netRewardRisk:rows.filter(r=>!r.netRewardRiskPass).length,netCostMargin:rows.filter(r=>!r.netCostMarginPass).length},rows};
});
const report={protocol:'maker-pullback-admission-diagnosis-v1',protocolFrozenCommit:summary.protocolFrozenCommit,sourceDatasetSha256:summary.sourceDatasetSha256,minuteSourceSha256:summary.minuteSourceSha256,ledgerFileSha256:createHash('sha256').update(readFileSync(resultDir+'/ledgers.json')).digest('hex'),runs,
 ownedTradeMfeMae:summary.runs.map(r=>({scenario:r.scenario,trades:r.closedTrades,mfe:null,mae:null,reason:r.closedTrades===0?'no_filled_trades_not_zero_excursion':'requires_owned_interval_attribution'})),
 limitations:['Static starting-bank quotes per raw signal, no orders or hypothetical performance replay; not a new strategy variant. Current replay placed no orders, so bank/exposure remained unchanged.',
 'Independent rejection counts overlap; do not add them. All declared alternatives remain frozen; these quotes are not used to select a new target or relax the gate.',
 'Zero orders cannot validate historical partial fills, timeout effectiveness, maker fee actual payment, queue priority, MFE/MAE of positions or positive expectation. Order mechanics were tested synthetically only.'],ordersSent:0,realMoneyApproved:false};
writeFileSync(outPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'admission_diagnosis_complete',runs:runs.map(({rows,...r})=>r)}));
