type ScreeningRun={name:string;scenario:string;closedTrades:number;expectancyUsdt:number|null;profitFactor:number|null;netReturnUsdt:number;blocks:Array<{complete:boolean;netReturnUsdt:number}>};
export function screenEconomicCandidates(runs:ScreeningRun[]){
 return ['A_VOLUME_OFF','A_TOUCH_1_ATR','B_NET_RR_1_5','B_ATR_OFF'].map(name=>{
  const cases=runs.filter(r=>r.name===name);const checks=cases.map(r=>({scenario:r.scenario,sample:Number.isSafeInteger(r.closedTrades)&&r.closedTrades>=30,ev:r.expectancyUsdt!==null&&Number.isFinite(r.expectancyUsdt)&&r.expectancyUsdt>0,pf:r.profitFactor!==null&&Number.isFinite(r.profitFactor)&&r.profitFactor>1,net:Number.isFinite(r.netReturnUsdt)&&r.netReturnUsdt>0,blocks:r.blocks.length===3&&r.blocks.every(b=>b.complete&&Number.isFinite(b.netReturnUsdt)&&b.netReturnUsdt>0)}));
  return {name,eligibleForFutureIndependentProtocol:checks.length===2&&new Set(cases.map(c=>c.scenario)).size===2&&cases.every(c=>['account-conditioned','account-cost-stress'].includes(c.scenario))&&checks.every(c=>c.sample&&c.ev&&c.pf&&c.net&&c.blocks),checks};
 });

}
