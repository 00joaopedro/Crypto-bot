import { quantizeQuantityDown } from './decimal-quantity.js';
/** Called after a fully closed hour; the returned stop applies only to the following bar. */
export function compressionTrailUpdate(q:{armed:boolean;stop:number;initialStop:number;peakClose:number;close:number;atr:number;quantity:number;cost:number;taker:number;friction:number;tick:number}){
 if(![q.stop,q.initialStop,q.peakClose,q.close,q.atr,q.quantity,q.cost,q.tick].every(v=>Number.isFinite(v)&&v>0)||![q.taker,q.friction].every(v=>Number.isFinite(v)&&v>=0&&v<1))throw new Error('Valid closed-hour trailing quote required');
 const proceeds=(p:number)=>q.quantity*p*(1-q.taker)*(1-q.friction),initialNetRisk=q.cost-proceeds(q.initialStop),netAtClose=proceeds(q.close)-q.cost;
 const armed=q.armed||(initialNetRisk>0&&netAtClose>=2*initialNetRisk),peakClose=Math.max(q.peakClose,q.close),raw=peakClose-2*q.atr;
 const proposal=raw>0?quantizeQuantityDown(raw,1,q.tick).quantity:0;
 const stop=armed&&proposal>0&&proposal<q.close?Math.max(q.stop,proposal):q.stop;
 return {armed,stop,peakClose};
}
