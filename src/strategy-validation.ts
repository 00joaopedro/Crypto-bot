import { runWalkForward, type WalkForwardOptions } from "./walk-forward.js";
import type { Candle } from "./types.js";

/** Offline estimate; it cannot establish exchange fills or operational parity. */
export function validateDemoStrategy(candles: Candle[], options: WalkForwardOptions) {
  if (options.candidates.length !== 1) throw new Error("Use exactly one fixed candidate for out-of-sample validation");
  const candidate = options.candidates[0];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || Object.keys(candidate).some((key) => !["stopLossRate", "takeProfitRate", "minimumSignalScore", "executionDelayCandles"].includes(key))) throw new Error("Invalid fixed candidate fields");
  if ((options.stepCandles ?? options.testCandles) < options.testCandles) throw new Error("Test windows must not overlap");
  if (options.base.qualityFilters === false) throw new Error("Demo validation requires the production quality filters");
  if (options.base.executionProfile !== "demo-proxy") throw new Error("Demo validation requires demo-proxy execution profile");
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (![c.timestamp, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) || !Number.isSafeInteger(c.timestamp) || c.timestamp < 0 || c.open <= 0 || c.close <= 0 || c.low <= 0 || c.volume < 0 || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || (i > 0 && c.timestamp - candles[i - 1]!.timestamp !== 900_000)) throw new Error("Candles must be valid, ordered and contiguous 15-minute data");
  }
  const result = runWalkForward(candles, options);
  return {
    status: "simulation_only" as const,
    result,
    outOfSampleTrades: result.windows.reduce((total, window) => total + window.testMetrics.trades, 0),
    limitations: [
      "Simulated fills and fees are assumptions; OKX execution is not verified.",
      "Demo stop and target are approximated; bid/ask, exchange precision and intrabar order are unknown.",
      "Portfolio risk, cooldowns, AI, dynamic symbol selection and ATR exits are not reproduced.",
      "This report cannot establish production readiness or profitability.",
    ],
  };
}
