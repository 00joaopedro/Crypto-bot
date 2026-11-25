export const EVOLUTION_CASES=[['A_REFERENCE','trend_pullback','reference'],['B_REFERENCE','mean_reversion','reference'],['AB_REFERENCE','hybrid','reference'],['A_TRANSITION','trend_pullback','transition'],['B_TRANSITION','mean_reversion','transition'],['A_REGIME','trend_pullback','regime'],['B_REGIME','mean_reversion','regime'],['A_ROI','trend_pullback','roi'],['B_ROI','mean_reversion','roi'],['A_FULL','trend_pullback','full'],['B_FULL','mean_reversion','full'],['AB_FULL','hybrid','full'],['C_SQUEEZE','squeeze','squeeze']] as const;
type ScreenRun={name:string;scenario:string;closedTrades:number;expectancyUsdt:number|null;profitFactor:number|null;netReturnUsdt:number;maxDrawdownPercent:number;realizedPnlWithoutTop3Usdt:number;blocks:Array<{complete:boolean;netReturnUsdt:number}>};
export function screenEvolution(runs:ScreenRun[]){
 const selection=EVOLUTION_CASES.filter(c=>c[2]!=='reference').map(([name])=>{
  const cases=runs.filter(r=>r.name===name),checks=cases.map(r=>({scenario:r.scenario,sample:Number.isSafeInteger(r.closedTrades)&&r.closedTrades>=30,ev:r.expectancyUsdt!==null&&Number.isFinite(r.expectancyUsdt)&&r.expectancyUsdt>0,pf:r.profitFactor!==null&&Number.isFinite(r.profitFactor)&&r.profitFactor>1.25,net:Number.isFinite(r.netReturnUsdt)&&r.netReturnUsdt>0,drawdown:Number.isFinite(r.maxDrawdownPercent)&&r.maxDrawdownPercent>=0&&r.maxDrawdownPercent<10,withoutTop3:Number.isFinite(r.realizedPnlWithoutTop3Usdt)&&r.realizedPnlWithoutTop3Usdt>0,blocks:r.blocks.length===3&&r.blocks.every(b=>b.complete&&Number.isFinite(b.netReturnUsdt)&&b.netReturnUsdt>0)}));
  return {name,checks,eligibleForFutureIndependentProtocol:cases.length===2&&new Set(cases.map(c=>c.scenario)).size===2&&cases.every(c=>['account-conditioned','account-cost-stress'].includes(c.scenario))&&checks.every(c=>c.sample&&c.ev&&c.pf&&c.net&&c.drawdown&&c.withoutTop3&&c.blocks)};
 });
 const combined=selection.find(s=>s.name==='AB_FULL')!;
 combined.eligibleForFutureIndependentProtocol &&= selection.find(s=>s.name==='A_FULL')!.eligibleForFutureIndependentProtocol&&selection.find(s=>s.name==='B_FULL')!.eligibleForFutureIndependentProtocol;
 return selection;
}
