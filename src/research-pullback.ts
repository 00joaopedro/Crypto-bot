import { z } from "zod";
import type { Candle } from "./types.js";

export const pullbackRuleSchema = z.enum(["near-ema21", "confirmed-pullback", "confirmed-pullback-rsi58"]);
export type PullbackRule = z.infer<typeof pullbackRuleSchema>;
export const PULLBACK_RULES = { maximumExtensionAtr: 0.8, touchDistanceAtr: 0.25, expiryCandles: 4, maximumRsi: 58 } as const;
export type PullbackObservation = { candle: Candle; ema21: number; atr: number; rsi: number; bullish: boolean };
/** One state machine per asset; called once per completed candle, including non-BUY bars. */
export function createPullbackGate(rule: PullbackRule) {
  pullbackRuleSchema.parse(rule);
  let previous: PullbackObservation | undefined;
  let pending: { low: number; age: number } | undefined;
  let armed = false;
  return (current: PullbackObservation): boolean => {
    const { candle: c, ema21, atr, rsi, bullish } = current;
    if (previous && c.timestamp !== previous.candle.timestamp + 900_000) throw new Error("Pullback gate requires consecutive closed candles");
    if (![c.open,c.high,c.low,c.close,ema21,atr,rsi].every(Number.isFinite) || atr < 0) throw new Error("Invalid pullback observation");
    const prior = previous; previous = current;
    if (atr === 0) { pending = undefined; armed = false; return false; }
    const extension = (c.close - ema21) / atr;
    const near = extension >= 0 && extension <= PULLBACK_RULES.maximumExtensionAtr;
    if (rule === "near-ema21") return near;
    if (!bullish) { pending = undefined; armed = false; return false; }
    if (pending) {
      pending.age++;
      if (pending.age > PULLBACK_RULES.expiryCandles || c.low < pending.low) {
        pending = undefined; // Invalidations do not refresh the setup or permit a same-bar retry.
      } else if (prior && c.close > prior.candle.high && c.close > c.open && c.close > ema21) {
        pending = undefined; // Consume even if quality, membership, RSI or portfolio later rejects it.
        return near && (rule !== "confirmed-pullback-rsi58" || rsi <= PULLBACK_RULES.maximumRsi);
      }
      return false;
    }
    if (extension > PULLBACK_RULES.maximumExtensionAtr) armed = true;
    if (armed && prior && c.close < prior.candle.close && c.low <= ema21 + PULLBACK_RULES.touchDistanceAtr * atr) {
      pending = { low: c.low, age: 0 }; armed = false;
    }
    return false;
  };
}
