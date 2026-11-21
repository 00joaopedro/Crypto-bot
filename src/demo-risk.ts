export class DemoRiskBasisChangedError extends Error {}
export type DemoRiskBasis = { budgetUsdt: number; baselineAt: number };
export type DemoRiskState = { basis?: DemoRiskBasis; day: string; dayStartEquity: number; peakEquity: number; equity: number; observedAt: number };
/** Reject stale/invalid observations; restarting never resets the peak. */
export function advanceDemoRisk(previous: DemoRiskState | null, equity: number, observedAt: number, basis?: DemoRiskBasis): DemoRiskState {
  if (!Number.isFinite(equity) || (!basis && equity <= 0) || !Number.isSafeInteger(observedAt) || observedAt <= 0 || (previous && observedAt < previous.observedAt)) throw new Error('Invalid Demo equity observation');
  if (basis && (!Number.isFinite(basis.budgetUsdt) || basis.budgetUsdt <= 0 || !Number.isSafeInteger(basis.baselineAt) || basis.baselineAt <= 0 || basis.baselineAt > observedAt)) throw new Error('Invalid Demo risk basis');
  // A test cycle, restart, budget edit or replacement accounting origin cannot erase risk.
  if (previous && (previous.basis?.budgetUsdt !== basis?.budgetUsdt || previous.basis?.baselineAt !== basis?.baselineAt)) throw new DemoRiskBasisChangedError('Demo risk basis changed; review required');
  const initial = basis?.budgetUsdt ?? equity;
  const day = new Date(observedAt).toISOString().slice(0, 10);
  return { ...(basis ? { basis } : {}), day, dayStartEquity: previous?.day === day ? previous.dayStartEquity : (previous ? (equity > 0 ? equity : previous.dayStartEquity) : initial), peakEquity: Math.max(previous?.peakEquity ?? initial, equity), equity, observedAt };
}
export function demoRiskBlock(state: DemoRiskState, maxDailyLoss: number, maxDrawdown: number): string | undefined {
  if ((state.dayStartEquity - state.equity) / state.dayStartEquity >= maxDailyLoss) return 'demo_daily_loss_limit';
  if ((state.peakEquity - state.equity) / state.peakEquity >= maxDrawdown) return 'demo_drawdown_limit';
  return undefined;
}
