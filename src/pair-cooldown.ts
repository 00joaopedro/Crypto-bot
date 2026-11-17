import { z } from "zod";

export const pairCooldownSchema = z.object({
  hours: z.number().int().min(1).max(168),
  minLosses: z.number().int().min(2).max(20),
}).strict();

export type PairCooldown = z.infer<typeof pairCooldownSchema>;
export const HOUR_MS = 3_600_000;
export const PAIR_COOLDOWN_LOOKBACK_MS = 48 * HOUR_MS;

/** History is newest first and contains only trades known to be closed at this instant. */
export function pairCooldownUntil(
  recent: readonly { closedAt: number; netPnlUsdt: number }[],
  now: number,
  policy: PairCooldown,
): number | undefined {
  const sample = recent.slice(0, policy.minLosses);
  const newest = sample[0]?.closedAt ?? now;
  if (sample.length < policy.minLosses || !sample.every(trade =>
    trade.closedAt <= now && trade.closedAt >= newest - PAIR_COOLDOWN_LOOKBACK_MS &&
    Number.isFinite(trade.netPnlUsdt) && trade.netPnlUsdt < 0,
  )) return undefined;

  const until = newest + policy.hours * HOUR_MS;
  return until > now ? until : undefined;
}
