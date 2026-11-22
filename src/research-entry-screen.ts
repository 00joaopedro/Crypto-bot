import { z } from "zod";
import { initialExitRates } from "./exit-policy.js";
import { comparisonSlippage, symbolCostSchema, type ComparisonOptions } from "./strategy-comparison.js";
import type { Candle } from "./types.js";

export const researchEntryScreenSchema = z.object({ minimumTargetCostMultiple: z.number().finite().min(1).max(5) }).strict();
export type ResearchEntryScreen = z.infer<typeof researchEntryScreenSchema>;

/** Cost proxy known at signal close. A distant target is not expected profit or a fill forecast. */
export function screenResearchEntry(candles: Candle[], parameters: ComparisonOptions["baseline"], rawCosts: z.infer<typeof symbolCostSchema>, rawScreen: ResearchEntryScreen) {
  const screen = researchEntryScreenSchema.parse(rawScreen), costs = symbolCostSchema.parse(rawCosts);
  if (!parameters.exitPolicy || parameters.exitPolicy.mode !== "fixed" || parameters.exitPolicy.breakeven) throw new Error("Cost screen requires fixed ATR exits without breakeven");
  const last = candles.at(-1);
  if (!last || !Number.isFinite(last.close) || last.close <= 0) throw new Error("Closed signal candles required");
  const targetRate = initialExitRates(candles, last.close, parameters.exitPolicy, parameters).takeProfitRate;
  const execution = comparisonSlippage(costs);
  // Both legs, using the same spread/slippage proxy as the replay. No fees charged twice.
  const feeMultiplier = costs.entryFeeCurrency === "base" ? 1 / (1 - costs.feeRate) ** 2 : (1 + costs.feeRate) / (1 - costs.feeRate);
  const breakEvenMoveRate = (1 + execution) / (1 - execution) * feeMultiplier - 1;
  return { allowed: targetRate >= screen.minimumTargetCostMultiple * breakEvenMoveRate, targetRate, breakEvenMoveRate,
    targetCostMultiple: breakEvenMoveRate > 0 ? targetRate / breakEvenMoveRate : null };
}
