import { expect, it, vi } from "vitest";
import { autoResumeAt, describeAutoResume, inspectAutoResumeMarket, inspectAutoResumePaperRisk, type PauseControl } from "../src/auto-resume.js";
import { PaperTrader } from "../src/paper-trader.js";
import { BTC_REGIME_HISTORY, REGIME_CANDLE_MS } from "../src/btc-regime.js";

const now = Date.parse("2026-11-17T00:00:00Z");
const control: PauseControl = {
  paused: true, revision: "42", updatedAt: new Date("2026-11-16T23:30:00Z"),
  updatedBy: "system:consecutive_losses", pauseReason: "consecutive_losses",
};

it("rebuilds the due time from the persisted pause and requires a known origin", () => {
  expect(autoResumeAt(control, 120, false)).toBe(Date.parse("2026-11-17T01:30:00Z"));
  expect(autoResumeAt({ ...control, updatedBy: "dashboard" }, 120, true)).toBeNull();
  const demoPause = { ...control, updatedBy: "system:demo_execution_safety" };
  expect(autoResumeAt({ ...demoPause, pauseReason: "demo_daily_loss_limit" }, 120, true)).toBe(now);
  expect(autoResumeAt({ ...demoPause, pauseReason: "demo_drawdown_limit" }, 120, true)).toBeNull();
  expect(autoResumeAt({ ...demoPause, pauseReason: "pending_demo_order" }, 120, true)).toBe(control.updatedAt!.getTime());
  expect(autoResumeAt({ ...demoPause, pauseReason: "pending_demo_order" }, 120, false)).toBeNull();
  expect(autoResumeAt({ ...demoPause, pauseReason: "unrecognized_failure" }, 120, true)).toBeNull();
  expect(autoResumeAt({ ...control, updatedBy: "system:risk_limit", pauseReason: "paper_daily_loss_limit" }, 120, false)).toBe(now);
});

it("keeps an independent Paper drawdown or loss cooldown active after the pause becomes eligible", async () => {
  const trader = new PaperTrader({ initialBalanceUsdt: 1000, tradeSizeUsdt: 100, feeRate: .001, slippageRate: .001, stopLossRate: .01, takeProfitRate: .02 });
  const checkpoint = { symbol: "BTC/USDT", state: { ...trader.exportState(), cashUsdt: 800 }, updated_at: new Date(now), last_processed_candle: String(now - REGIME_CANDLE_MS), daily_start_equity: null };
  const market = { fetchClosedCandles: vi.fn() };
  const options = { fee: .001, maxDailyLoss: .03, maxDrawdown: .10, candleLimit: 100, now, maxConsecutiveLosses: 3, cooldownMinutes: 120 };
  await expect(inspectAutoResumePaperRisk({ loadPaperResumeStates: async () => [checkpoint] }, market, options)).resolves.toBe("paper_drawdown_limit");
  const lossCheckpoint = { ...checkpoint, state: { ...trader.exportState(), consecutiveLosses: 3 } };
  await expect(inspectAutoResumePaperRisk({ loadPaperResumeStates: async () => [lossCheckpoint] }, market, options)).resolves.toBe("paper_loss_cooldown_active");
  await expect(inspectAutoResumePaperRisk({ loadPaperResumeStates: async () => [lossCheckpoint] }, market, { ...options, now: now + 120 * 60_000 })).resolves.toBeUndefined();
});

it("requires recent closed BTC candles when the market gate is used", async () => {
  const candles = Array.from({ length: BTC_REGIME_HISTORY }, (_, index) => ({
    timestamp: now - (BTC_REGIME_HISTORY - index) * REGIME_CANDLE_MS, open: 100, high: 101, low: 99, close: 100, volume: 1,
  }));
  await expect(inspectAutoResumeMarket({ fetchClosedCandles: async () => candles.slice(0, -1) }, now)).resolves.toBe("btc_regime_data_unavailable");
  await expect(inspectAutoResumeMarket({ fetchClosedCandles: async () => candles }, now)).resolves.toBeUndefined();
});

it("reports disabled, scheduled, blocked and manual states by the current pause revision", () => {
  const enabled = { enabled: true, cooldownMinutes: 120, demo: true };
  const check = { revision: "42", checkedAt: now, reason: "btc_regime_shock" };
  expect(describeAutoResume(control, { ...enabled, enabled: false }, check)).toEqual({ enabled: false, eligibleAt: null });
  expect(describeAutoResume(control, enabled, check)).toMatchObject({ enabled: true, reason: check.reason, eligibleAt: Date.parse("2026-11-17T01:30:00Z") });
  expect(describeAutoResume({ ...control, revision: "43" }, enabled, check)).not.toHaveProperty("reason");
  expect(describeAutoResume({ ...control, updatedBy: "dashboard" }, enabled, check)).toEqual({ enabled: true, eligibleAt: null });
});

it("only schedules a new safety check for reconciliable exit pauses, never a manual pause",()=>{
 const p={...control,updatedBy:"system:demo_exit_supervision",pauseReason:"partial_exit_without_live_coverage"};
 expect(autoResumeAt(p,120,true)).toBe(control.updatedAt!.getTime());
 expect(autoResumeAt({...p,updatedBy:"dashboard"},120,true)).toBeNull();
 expect(autoResumeAt(p,120,false)).toBeNull();
});

it('exposes the attribution detail only for the current recheckable pause revision', () => {
  const paused: PauseControl = { ...control, updatedBy: 'system:demo_execution_safety', pauseReason: 'demo_bot_risk_attribution_unconfirmed' };
  const options = { enabled: true, cooldownMinutes: 120, demo: true };
  const check = { revision: paused.revision, checkedAt: now, reason: paused.pauseReason!, attributionReason: 'position_balance_missing', balanceEvidence: { asset: 'SOL', expected: .5, actual: null, source: 'bot_position' as const } };
  expect(describeAutoResume(paused, options, check)).toMatchObject({ attributionReason: check.attributionReason, balanceEvidence: check.balanceEvidence });
  expect(describeAutoResume({ ...paused, revision: 'next' }, options, check)).not.toHaveProperty('balanceEvidence');
});
