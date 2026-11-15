import type { Candle } from "./types.js";

export const REGIME_CANDLE_MS = 900_000;
const TREND_CANDLES = 96;
const SHOCK_CANDLES = 16;
const MAX_SHOCK_LOSS = 0.03;
const RECOVERY_CANDLES = 3;
export const BTC_REGIME_HISTORY = TREND_CANDLES + RECOVERY_CANDLES - 1;

type RegimeBlock = "btc_regime_data_unavailable" | "btc_regime_downtrend" | "btc_regime_shock" | "btc_regime_recovering";

/** Uses only the closed BTC candles available at the decision timestamp. */
export function btcRegimeBlock(candles: readonly Candle[], timestamp: number, end = candles.length - 1): RegimeBlock | undefined {
  const first = end - BTC_REGIME_HISTORY + 1;
  if (first < 0 || candles[end]?.timestamp !== timestamp) return "btc_regime_data_unavailable";
  for (let i = first; i <= end; i++) {
    const candle = candles[i];
    if (!candle || !Number.isFinite(candle.close) || candle.close <= 0 ||
      candle.timestamp !== timestamp - (end - i) * REGIME_CANDLE_MS) {
      return "btc_regime_data_unavailable";
    }
  }

  for (let offset = 0; offset < RECOVERY_CANDLES; offset++) {
    const index = end - offset;
    const close = candles[index]!.close;
    const shock = close <= candles[index - SHOCK_CANDLES]!.close * (1 - MAX_SHOCK_LOSS);
    let total = 0;
    for (let i = index - TREND_CANDLES + 1; i <= index; i++) total += candles[i]!.close;
    if (shock || close < total / TREND_CANDLES) {
      if (offset > 0) return "btc_regime_recovering";
      return shock ? "btc_regime_shock" : "btc_regime_downtrend";
    }
  }
  return undefined;
}
