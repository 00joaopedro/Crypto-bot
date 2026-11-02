export type DemoRiskState = { day: string; dayStartEquity: number; peakEquity: number; equity: number; observedAt: number };
/** Reject stale/invalid observations; restarting never resets the peak. */
export function advanceDemoRisk(previous: DemoRiskState | null, equity: number, observedAt: number): DemoRiskState {
  if (!Number.isFinite(equity) || equity <= 0 || !Number.isSafeInteger(observedAt) || observedAt <= 0 || (previous && observedAt < previous.observedAt)) throw new Error('Invalid Demo equity observation');
  const day = new Date(observedAt).toISOString().slice(0, 10);
  return { day, dayStartEquity: previous?.day === day ? previous.dayStartEquity : equity, peakEquity: Math.max(previous?.peakEquity ?? equity, equity), equity, observedAt };
}
export function demoRiskBlock(state: DemoRiskState, maxDailyLoss: number, maxDrawdown: number): string | undefined {
  if ((state.dayStartEquity - state.equity) / state.dayStartEquity >= maxDailyLoss) return 'demo_daily_loss_limit';
  if ((state.peakEquity - state.equity) / state.peakEquity >= maxDrawdown) return 'demo_drawdown_limit';
  return undefined;
}
