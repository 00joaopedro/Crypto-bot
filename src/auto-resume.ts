import type { DemoBalanceEvidence } from './demo-ledger.js';
import { BTC_REGIME_HISTORY, REGIME_CANDLE_MS, btcRegimeBlock } from "./btc-regime.js";
import type { PublicMarketData } from "./market-data.js";
import type { PostgresPersistence } from "./persistence.js";

export type PauseControl = {
  paused: boolean;
  revision: string;
  pauseReason: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
};

const recheckableDemoReasons = new Set([
  "demo_accounting_checkpoint_busy", "demo_order_not_confirmed", "demo_bot_risk_attribution_unconfirmed", "demo_balance_unconfirmed", "demo_equity_risk_unconfirmed", "demo_account_identity_unconfirmed",
  "demo_trading_permission_unconfirmed", "demo_resume_check_failed", "pending_demo_order",
  "unresolved_demo_failure", "demo_position_without_live_protection", "demo_safety_check_failed",
  "protection_audit_failed", "protection_account_unconfirmed", "exit_supervision_failed",
  "partial_exit_without_live_coverage", "demo_exit_not_reconciled",
  "exit_fills_incomplete", "protective_order_unconfirmed", "exit_protection_not_live",
  "exit_candles_invalid", "exit_candles_stale", "exit_candle_gap",
]);

export function autoResumeAt(control: PauseControl, cooldownMinutes: number, demo: boolean): number | null {
  if (!control.paused || !control.updatedBy || !control.pauseReason) return null;
  const updatedAt = control.updatedAt?.getTime();
  if (updatedAt === undefined || !Number.isFinite(updatedAt)) return null;
  if (control.updatedBy === "system:consecutive_losses" && control.pauseReason === "consecutive_losses") {
    return updatedAt + cooldownMinutes * 60_000;
  }
  const fromDemo = demo && ["system:demo_execution_safety", "system:demo_exit_supervision", "system:demo_position_uncertain", "system:demo_order_not_confirmed"].includes(control.updatedBy);
  if ((fromDemo && control.pauseReason === "demo_daily_loss_limit") ||
      (control.updatedBy === "system:risk_limit" && control.pauseReason === "paper_daily_loss_limit")) {
    return (Math.floor(updatedAt / 86_400_000) + 1) * 86_400_000;
  }
  return fromDemo && recheckableDemoReasons.has(control.pauseReason) ? updatedAt : null;
}

export function describeAutoResume(
  control: PauseControl,
  options: { enabled: boolean; cooldownMinutes: number; demo: boolean },
  lastCheck?: { revision: string; checkedAt: number; reason: string; attributionReason?: string; balanceEvidence?: DemoBalanceEvidence },
) {
  const eligibleAt = options.enabled ? autoResumeAt(control, options.cooldownMinutes, options.demo) : null;
  const check = eligibleAt !== null && lastCheck?.revision === control.revision ? lastCheck : undefined;
  return {
    enabled: options.enabled,
    eligibleAt,
    ...(check ? { checkedAt: check.checkedAt, reason: check.reason, ...(check.attributionReason ? { attributionReason: check.attributionReason } : {}), ...(check.balanceEvidence ? { balanceEvidence: check.balanceEvidence } : {}) } : {}),
  };
}

export async function inspectAutoResumePaperRisk(
  store: Pick<PostgresPersistence, "loadPaperResumeStates">,
  market: Pick<PublicMarketData, "fetchClosedCandles">,
  options: { fee: number; maxDailyLoss: number; maxDrawdown: number; candleLimit: number; now: number; maxConsecutiveLosses: number; cooldownMinutes: number },
): Promise<string | undefined> {
  const expected = Math.floor(options.now / REGIME_CANDLE_MS) * REGIME_CANDLE_MS - REGIME_CANDLE_MS;
  for (const row of await store.loadPaperResumeStates()) {
    const { position, cashUsdt, peakEquityUsdt, consecutiveLosses } = row.state;
    if (consecutiveLosses !== undefined && consecutiveLosses >= options.maxConsecutiveLosses &&
        options.now < row.updated_at.getTime() + options.cooldownMinutes * 60_000) return "paper_loss_cooldown_active";
    let equity = cashUsdt;
    if (position) {
      const candles = await market.fetchClosedCandles(row.symbol, options.candleLimit);
      const latest = candles.at(-1);
      const cursor = Number(row.last_processed_candle);
      const unseen = candles.filter(candle => candle.timestamp > cursor);
      if (!latest || latest.timestamp !== expected || !Number.isSafeInteger(cursor) || cursor > expected ||
          unseen.some((candle, index) => candle.timestamp !== cursor + (index + 1) * REGIME_CANDLE_MS || !Number.isFinite(candle.close) || candle.close <= 0) ||
          !Number.isFinite(latest.close) || latest.close <= 0) return "paper_resume_candles_unconfirmed";
      equity += position.quantity * latest.close * (1 - options.fee);
    }
    const daily = row.daily_start_equity ?? equity;
    if (![equity, daily, peakEquityUsdt].every(value => Number.isFinite(value) && value > 0)) return "paper_resume_equity_unconfirmed";
    if ((peakEquityUsdt - equity) / peakEquityUsdt >= options.maxDrawdown) return "paper_drawdown_limit";
    if ((daily - equity) / daily >= options.maxDailyLoss) return "paper_daily_loss_limit";
  }
}

export async function inspectAutoResumeMarket(market: Pick<PublicMarketData, "fetchClosedCandles">, now: number) {
  const timestamp = Math.floor(now / REGIME_CANDLE_MS) * REGIME_CANDLE_MS - REGIME_CANDLE_MS;
  const candles = await market.fetchClosedCandles("BTC/USDT", BTC_REGIME_HISTORY);
  return btcRegimeBlock(candles, timestamp, candles.findIndex(candle => candle.timestamp === timestamp));
}
