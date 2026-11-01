import { demoRiskBlock } from './demo-risk.js';
import { inspectDemoExecutionState } from './demo-execution-safety.js';
import { sameDemoAccount } from './okx-demo-identity.js';
import type { PostgresPersistence } from './persistence.js';
import type { OkxDemoExecutor } from './okx-demo.js';

/** Fresh, read-only admission. Paper positions never establish Demo exposure. */
export async function inspectDemoEntry(
  persistence: Pick<PostgresPersistence, 'demoOrderJournal' | 'getDemoBaselineCandidate' | 'canEnterDemoSymbol' | 'observeDemoRisk'>,
  executor: Pick<OkxDemoExecutor, 'collectOrderEvidence' | 'inspectAccountIdentity' | 'getAccountSnapshot'>,
  input: { symbol: string; size: number; stopLossRate: number; cooldownMinutes: number; maxPositions: number; maxExposure: number; riskPerTrade: number; maxDailyLoss: number; maxDrawdown: number },
): Promise<{ allowed: boolean; reason?: string }> {
  const no = (reason: string) => ({ allowed: false, reason });
  try {
    if (Object.values(input).some(v => typeof v === 'number' && (!Number.isFinite(v) || v < 0)) || input.size <= 0 || input.stopLossRate <= 0 || input.maxPositions < 1) return no('invalid_demo_risk_configuration');
    const baseline = await persistence.getDemoBaselineCandidate();
    const account = await executor.inspectAccountIdentity();
    if (!baseline || account.status !== 'confirmed' || !sameDemoAccount(baseline.evidence.accountIdentity, account.identity)) return no('demo_account_identity_unconfirmed');
    const state = await inspectDemoExecutionState(persistence, executor);
    if (state.status !== 'safe') return no(state.reason);
    if (state.positions.some(p => p.symbol === input.symbol)) return no('demo_position_already_open');
    if (state.positions.length >= input.maxPositions) return no('demo_max_concurrent_positions');
    if (!await persistence.canEnterDemoSymbol(input.symbol, input.cooldownMinutes)) return no('demo_entry_cooldown');
    const snapshot = await executor.getAccountSnapshot();
    const equity = snapshot.equityUsdt, free = snapshot.quoteFree;
    if (equity === null || free === null || !Number.isFinite(equity) || !Number.isFinite(free) || equity <= 0 || free < 0 || free > equity) return no('demo_balance_unconfirmed');
    const risk = await persistence.observeDemoRisk(`${account.identity.mainUid}:${account.identity.uid}`, equity, Date.now());
    const lossBlock = demoRiskBlock(risk, input.maxDailyLoss, input.maxDrawdown);
    if (lossBlock) return no(lossBlock);
    if (free < input.size) return no('demo_insufficient_quote_balance');
    // Includes non-bot holdings and reserved quote funds conservatively.
    if ((equity - free + input.size) / equity > input.maxExposure) return no('demo_max_exposure');
    if (input.size * input.stopLossRate / equity > input.riskPerTrade) return no('demo_risk_per_trade');
    return { allowed: true };
  } catch { return no('demo_entry_check_failed'); }
}

/** Monitor account equity even when no new entry signal is present. */
export async function inspectDemoEquityRisk(
  persistence: Pick<PostgresPersistence, 'getDemoBaselineCandidate' | 'observeDemoRisk'>,
  executor: Pick<OkxDemoExecutor, 'inspectAccountIdentity' | 'getAccountSnapshot'>,
  maxDailyLoss: number, maxDrawdown: number,
): Promise<{ status: 'safe' } | { status: 'blocked'; reason: string }> {
  try {
    const baseline = await persistence.getDemoBaselineCandidate();
    const account = await executor.inspectAccountIdentity();
    if (!baseline || account.status !== 'confirmed' || !sameDemoAccount(baseline.evidence.accountIdentity, account.identity)) return { status: 'blocked', reason: 'demo_account_identity_unconfirmed' };
    const snapshot = await executor.getAccountSnapshot();
    if (snapshot.equityUsdt === null) return { status: 'blocked', reason: 'demo_balance_unconfirmed' };
    const state = await persistence.observeDemoRisk(`${account.identity.mainUid}:${account.identity.uid}`, snapshot.equityUsdt, Date.now());
    const reason = demoRiskBlock(state, maxDailyLoss, maxDrawdown);
    return reason ? { status: 'blocked', reason } : { status: 'safe' };
  } catch { return { status: 'blocked', reason: 'demo_equity_risk_unconfirmed' }; }
}
