import { z } from "zod";
import { averageTrueRange, emaSeries, rsiSeries } from "./indicators.js";
import { comparisonSlippage, symbolCostSchema } from "./strategy-comparison.js";
import type { Candle } from "./types.js";

export const CONFIRMED_REVERSION_RULES = {
  bandPeriod: 20, bandDeviations: 2, rsiPeriod: 7, maximumRsiExclusive: 25,
  expiryCandles: 4, downtrendEmaPeriod: 50, downtrendSlopeCandles: 4,
  target: "decision_sma20", stop: "reference_initial_atr14", costScreen: "positive_net_target_at_decision_and_entry",
} as const;
export type ReversionSetup = { targetPrice: number; decisionTimestamp: number };
export type ReversionObservation = {
  candle: Candle; sma20: number; lowerBand: number; deviation: number;
  rsi7: number; atr14: number; belowFallingEma50: boolean;
};
export function reversionObservation(candles: Candle[]): ReversionObservation {
  if(candles.length < 84) throw new Error("At least 84 closed candles required");
  const closes=candles.map(c=>c.close), recent=closes.slice(-20);
  if(closes.some(c=>!Number.isFinite(c)||c<=0))throw new Error("Invalid reversion closes");
  const sma20=recent.reduce((a,b)=>a+b,0)/20;
  const deviation=Math.sqrt(recent.reduce((a,b)=>a+(b-sma20)**2,0)/20);
  const ema50=emaSeries(closes,50),last=candles.at(-1)!;
  return {candle:last,sma20,lowerBand:sma20-2*deviation,deviation,rsi7:rsiSeries(closes,7).at(-1)!,atr14:averageTrueRange(candles,14),
    belowFallingEma50:last.close<ema50.at(-1)!&&ema50.at(-1)!<ema50.at(-5)!};
}
/** Each asset has its own clock and setup; one attempt at the first qualifying recovery. */
export function createConfirmedReversionGate(){
  let previous:ReversionObservation|undefined,pending:{age:number}|undefined;
  return (o:ReversionObservation):{reason:string;setup?:ReversionSetup}=>{
    const prior=previous;
    if(prior&&o.candle.timestamp!==prior.candle.timestamp+900000)throw new Error("Consecutive closed reversion candles required");
    if(![o.sma20,o.lowerBand,o.deviation,o.rsi7,o.atr14,o.candle.close,o.candle.open].every(Number.isFinite)||o.deviation<0||o.atr14<0)throw new Error("Invalid reversion observation");
    previous=o;
    if(o.deviation===0||o.atr14===0){pending=undefined;return {reason:"flat"};}
    const outside=o.candle.close<o.lowerBand;
    if(pending){
      pending.age++;
      if(pending.age>4){pending=undefined;return {reason:"expired"};}
      if(prior&&o.candle.close>o.lowerBand&&o.candle.close>o.candle.open&&o.candle.close>prior.candle.close){
        pending=undefined; // Consume before RSI, regime, quality, cost, membership or portfolio admission.
        if(o.rsi7>=25)return {reason:"recovery_rsi_rejected"};
        if(o.belowFallingEma50)return {reason:"falling_trend_rejected"};
        return {reason:"confirmed",setup:{targetPrice:o.sma20,decisionTimestamp:o.candle.timestamp}};
      }
      return {reason:"waiting"};
    }
    const previouslyOutside=prior!==undefined&&prior.candle.close<prior.lowerBand;
    if(outside&&!previouslyOutside&&o.rsi7<25){pending={age:0};return {reason:"setup"};}
    return {reason:"no_setup"};
  };
}
/** Per-unit cash return at the frozen target, after both fee legs and execution proxies. */
export function reversionTargetEconomics(entryMarketPrice:number,targetPrice:number,rawCosts:z.infer<typeof symbolCostSchema>){
  const costs=symbolCostSchema.parse(rawCosts);
  if(![entryMarketPrice,targetPrice].every(p=>Number.isFinite(p)&&p>0))throw new Error("Invalid reversion target prices");
  const execution=comparisonSlippage(costs),fill=entryMarketPrice*(1+execution);
  const quantity=costs.entryFeeCurrency==="base"?1-costs.feeRate:1;
  const cost=fill*(costs.entryFeeCurrency==="quote"?1+costs.feeRate:1);
  const proceeds=targetPrice*(1-execution)*quantity*(1-costs.feeRate);
  const netReturnRate=proceeds/cost-1;
  return {allowed:netReturnRate>0,netReturnRate};
}
