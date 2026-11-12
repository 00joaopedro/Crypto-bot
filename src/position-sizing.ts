import { z } from "zod";

export const positionSizingSchema = z.object({
  riskPerTrade: z.number().positive().max(0.01),
  maxExposure: z.number().positive().max(0.3),
  maxAltExposure: z.number().positive().max(0.3),
  maxSymbolExposure: z.number().positive().max(0.3),
}).strict();

export type PositionSizingLimits = z.infer<typeof positionSizingSchema>;

export function positionSize(input: {
  limits: PositionSizingLimits;
  equity: number;
  free: number;
  exposure: number;
  altExposure: number;
  symbolExposure: number;
  altcoin: boolean;
  ceiling: number;
  stopRate: number;
  fee: number;
  slippage: number;
  liquidity: number;
}): number {
  const { limits, equity, free, exposure, altExposure, symbolExposure, altcoin, ceiling, stopRate, fee, slippage, liquidity } = input;
  const values = [equity, free, exposure, altExposure, symbolExposure, ceiling, stopRate, fee, slippage, liquidity];
  if (values.some(v => !Number.isFinite(v) || v < 0) || stopRate <= 0 || stopRate >= 1 || fee >= 1 || slippage >= 1) return 0;
  // Conservative additive buffer for entry and exit execution costs.
  const lossRate = stopRate + 2 * (fee + slippage);
  return Math.max(0, Math.min(
    ceiling,
    free / (1 + fee),
    equity * limits.riskPerTrade / lossRate,
    equity * limits.maxExposure - exposure,
    equity * limits.maxSymbolExposure - symbolExposure,
    altcoin ? equity * limits.maxAltExposure - altExposure : ceiling,
    liquidity,
  ));
}
