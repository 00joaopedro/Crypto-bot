import { z } from "zod";
import { averageTrueRange } from "./indicators.js";
import type { Candle } from "./types.js";

export const exitPolicySchema = z.object({
  mode: z.enum(["fixed", "trailing_atr"]).default("fixed"),
  breakeven: z.boolean().default(false),
  atrPeriod: z.number().int().min(5).max(100).default(14),
  stopMultiplier: z.number().positive().max(10).default(1.5),
  targetMultiplier: z.number().positive().max(20).default(3),
  minStopRate: z.number().positive().lt(1).default(.005),
  maxStopRate: z.number().positive().lt(1).default(.03),
  trailingMultiplier: z.number().positive().max(20).default(2),
  activationRate: z.number().positive().lt(1).default(.02),
  exitFeeRate: z.number().nonnegative().lt(.1).default(.001),
  exitSlippageRate: z.number().nonnegative().lt(.1).default(.001),
}).strict().refine(p => p.minStopRate <= p.maxStopRate, "Invalid ATR stop range");
export type ExitPolicy = z.infer<typeof exitPolicySchema>;

export function initialExitRates(candles: Candle[], price: number, policy: ExitPolicy, fallback: { stopLossRate: number; takeProfitRate: number }) {
  const atr = averageTrueRange(candles, policy.atrPeriod);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(atr)) throw new Error("Invalid exit input");
  const stopLossRate = atr > 0 ? Math.min(policy.maxStopRate, Math.max(policy.minStopRate, atr / price * policy.stopMultiplier)) : fallback.stopLossRate;
  const takeProfitRate = atr > 0 ? Math.min(.5, Math.max(stopLossRate, atr / price * policy.targetMultiplier)) : fallback.takeProfitRate;
  return { stopLossRate, takeProfitRate };
}

/** Applied AFTER a candle closes. The new level is usable only on later candles. */
export function advanceExitStop(input: { stop: number; highWatermark: number; entryPrice: number; quantity: number; costUsdt: number; candles: Candle[]; policy: ExitPolicy }) {
  const { policy, candles } = input;
  const candle = candles.at(-1);
  if (!candle || ![input.stop, input.entryPrice, input.quantity, input.costUsdt].every(v => Number.isFinite(v) && v > 0)) throw new Error("Invalid exit position");
  const highWatermark = Math.max(input.highWatermark, input.entryPrice, candle.high);
  let stop = input.stop;
  if (highWatermark >= input.entryPrice * (1 + policy.activationRate)) {
    if (policy.mode === "trailing_atr") {
      const atr = averageTrueRange(candles, policy.atrPeriod);
      if (atr > 0 && Number.isFinite(atr)) stop = Math.max(stop, highWatermark - atr * policy.trailingMultiplier);
    }
    if (policy.breakeven) stop = Math.max(stop, input.costUsdt / (input.quantity * (1 - policy.exitFeeRate) * (1 - policy.exitSlippageRate)));
  }
  // Never loosen a stop. If the proposed level is already crossed at close,
  // retain the old exchange stop; do not invent a retroactive execution.
  return { highWatermark, stop: stop < candle.close ? stop : input.stop };
}
