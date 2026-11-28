import { z } from "zod";
import { averageTrueRange } from "./indicators.js";
import type { Candle } from "./types.js";

/** Offline only: no environment variable or operational configuration maps to this option. */
export const researchTrailingSchema = z.object({
  netActivationRate: z.number().finite().positive().lt(1),
  trailingMultiplier: z.number().finite().positive().max(20),
  retainFixedTarget: z.boolean(),
}).strict();
export type ResearchTrailing = z.infer<typeof researchTrailingSchema>;
export function netActivationPrice(costUsdt: number, quantity: number, feeRate: number, slippageRate: number, netRate: number) {
  if (![costUsdt, quantity].every(v => Number.isFinite(v) && v > 0) || ![feeRate, slippageRate, netRate].every(v => Number.isFinite(v) && v >= 0 && v < 1)) throw new Error("Invalid net activation inputs");
  // Entry costs are already in cash cost / net base quantity. Only modeled liquidation costs remain.
  return costUsdt * (1 + netRate) / (quantity * (1 - feeRate) * (1 - slippageRate));
}
export function advanceResearchTrailing(input: {
  stop: number; highWatermark: number; costUsdt: number; quantity: number; activated: boolean;
  candles: Candle[]; atrPeriod: number; feeRate: number; slippageRate: number; research: ResearchTrailing;
}) {
  const research = researchTrailingSchema.parse(input.research), last = input.candles.at(-1);
  if (!last || ![last.close,last.high,input.stop,input.highWatermark].every(v=>Number.isFinite(v)&&v>0)) throw new Error("Invalid research trailing input");
  const activationPrice = netActivationPrice(input.costUsdt,input.quantity,input.feeRate,input.slippageRate,research.netActivationRate);
  // A transient intrabar high is not enough. Latch only after a surviving candle CLOSE.
  const activated = input.activated || last.close >= activationPrice;
  const highWatermark = Math.max(input.highWatermark,last.high);
  const atr = averageTrueRange(input.candles,input.atrPeriod);
  const candidate = activated && atr > 0 ? Math.max(input.stop,highWatermark - research.trailingMultiplier * atr) : input.stop;
  return { activated, highWatermark, stop: candidate < last.close ? candidate : input.stop };
}
