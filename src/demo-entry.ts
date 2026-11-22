import { demoBotExposure, demoTradingExposure } from './demo-exposure.js';
import { botRiskEquity, type DemoRiskOptions } from './demo-risk-equity.js';
import { DemoRiskBasisChangedError, demoRiskBlock } from './demo-risk.js';
import { inspectDemoExecutionState, type VerifiedDemoPosition } from './demo-execution-safety.js';
import { sameDemoAccount } from './okx-demo-identity.js';
import type { PostgresPersistence } from './persistence.js';
import type { OkxDemoExecutor } from './okx-demo.js';

export type DemoExposure = {
  equityUsdt: number;
  freeUsdt: number;
  exposureUsdt: number;
  tradingEquityUsdt: number;
  brlReserveUsdt: number;
  requestedUsdt: number;
  projectedRate: number;
  limitRate: number;
  scope?: "bot" | "account";
};

export type DemoRiskEvidence = {
  scope: 'bot' | 'account'; observedAt: number; equityUsdt: number; dayStartEquityUsdt: number;
  peakEquityUsdt: number; dailyLossRate: number; drawdownRate: number;
  maxDailyLoss: number; maxDrawdown: number; budgetUsdt?: number; baselineAt?: number;
  realizedPnlUsdt?: number; unrealizedPnlUsdt?: number;
};
export type DemoEquityRiskResult = { status: 'safe' } | {
  status: 'blocked'; reason: string; riskEvidence?: DemoRiskEvidence; attributionReason?: string;
};
export type DemoAdmission = { riskEvidence?: DemoRiskEvidence; attributionReason?: string; allowed: boolean; reason?: string; entryRevision?: string; exposurePositions?: VerifiedDemoPosition[]; exposure?: DemoExposure };

/** Fresh admission using confirmed Demo balances and persisted account risk. */
export async function inspectDemoEntry(
  persistence: Pick<PostgresPersistence, 'demoOrderJournal' | 'getDemoBaselineCandidate' | 'canEnterDemoSymbol' | 'observeDemoRisk'> & Partial<Pick<PostgresPersistence, 'readDemoEntryRevision'>>,
  executor: Pick<OkxDemoExecutor, 'collectOrderEvidence' | 'inspectAccountIdentity' | 'getAccountSnapshot'>,
  input: DemoRiskOptions & { symbol: string; size: number; riskSizing?: boolean; stopLossRate: number; cooldownMinutes: number; maxPositions: number; maxExposure: number; riskPerTrade: number; maxDailyLoss: number; maxDrawdown: number },
): Promise<DemoAdmission> {
  const no = (reason: string) => ({ allowed: false, reason });
  try {
    if (Object.values(input).some(v => typeof v === 'number' && (!Number.isFinite(v) || v < 0)) || input.size <= 0 || input.stopLossRate <= 0 || input.maxPositions < 1) return no('invalid_demo_risk_configuration');
    const needsRevision = input.riskSizing || input.botBudgetUsdt !== undefined;
    const entryRevision = needsRevision ? await persistence.readDemoEntryRevision?.() : undefined;
    if (needsRevision && entryRevision === undefined) return no("demo_risk_revision_unavailable");
    const baseline = await persistence.getDemoBaselineCandidate();
    const account = await executor.inspectAccountIdentity();
    if (!baseline || account.status !== 'confirmed' || !sameDemoAccount(baseline.evidence.accountIdentity, account.identity)) return no('demo_account_identity_unconfirmed');
    const state = await inspectDemoExecutionState(persistence, executor);
    if (state.status !== 'safe') return no(state.reason);
    if (state.positions.some(p => p.symbol === input.symbol)) return no('demo_position_already_open');
    if (state.positions.length >= input.maxPositions) return no('demo_max_concurrent_positions');
    if (!await persistence.canEnterDemoSymbol(input.symbol, input.cooldownMinutes)) return no('demo_entry_cooldown');
    const snapshot = await executor.getAccountSnapshot();
    const portfolio = demoTradingExposure(snapshot);
    if (!portfolio) return no('demo_balance_unconfirmed');
    const risk = await inspectDemoEquityRisk(persistence, executor, input.maxDailyLoss, input.maxDrawdown, input);
    if (risk.status === 'blocked') {
      const { status: _status, ...block } = risk;
      return { allowed: false, ...block };
    }
    const botBudget = input.botBudgetUsdt;
    const operational = botBudget === undefined ? portfolio : demoBotExposure(snapshot, botBudget, state.positions);
    if (!operational) return no("demo_bot_exposure_unconfirmed");
    const authorization = {
      ...(entryRevision !== undefined ? { entryRevision } : {}),
      ...(botBudget !== undefined ? { exposurePositions: state.positions } : {}),
    };
    if (input.riskSizing) return { allowed: true, ...authorization };
    if (portfolio.freeUsdt < input.size) return no('demo_insufficient_quote_balance');
    const projectedRate = (operational.exposureUsdt + input.size) / operational.tradingEquityUsdt;
    if (projectedRate > input.maxExposure) return {
      ...no('demo_max_exposure'),
      exposure: { equityUsdt: operational.equityUsdt, freeUsdt: operational.freeUsdt, tradingEquityUsdt: operational.tradingEquityUsdt, brlReserveUsdt: operational.brlReserveUsdt, exposureUsdt: operational.exposureUsdt, scope: botBudget === undefined ? "account" : "bot", requestedUsdt: input.size, projectedRate, limitRate: input.maxExposure },
    };
    if (input.size * input.stopLossRate / operational.tradingEquityUsdt > input.riskPerTrade) return no('demo_risk_per_trade');
    return { allowed: true, ...authorization };
  } catch { return no('demo_entry_check_failed'); }
}

/** Monitor attributed bot equity (or legacy account scope without a budget), even without a BUY. */
export async function inspectDemoEquityRisk(
  persistence: Pick<PostgresPersistence, 'getDemoBaselineCandidate' | 'observeDemoRisk'>,
  executor: Pick<OkxDemoExecutor, 'inspectAccountIdentity' | 'getAccountSnapshot'>,
  maxDailyLoss: number, maxDrawdown: number, options: DemoRiskOptions = {},
): Promise<DemoEquityRiskResult> {
  try {
    const baseline = await persistence.getDemoBaselineCandidate();
    const account = await executor.inspectAccountIdentity();
    if (!baseline || account.status !== 'confirmed' || !sameDemoAccount(baseline.evidence.accountIdentity, account.identity)) return { status: 'blocked', reason: 'demo_account_identity_unconfirmed' };
    if (![maxDailyLoss, maxDrawdown].every(value => Number.isFinite(value) && value > 0 && value <= 1)) return { status: 'blocked', reason: 'invalid_demo_risk_configuration' };
    const budget = options.botBudgetUsdt;
    // Collect complete execution/bill evidence before marking owned net positions.
    // Transfers or unowned fills are rejected by reconciliation, never booked as a loss.
    const accounting = budget !== undefined ? await options.inspectAccounting?.() : undefined;
    if (budget !== undefined && !accounting) return { status: 'blocked', reason: 'demo_bot_risk_attribution_unconfirmed', attributionReason: 'risk_accounting_unavailable' };
    if (accounting?.status === 'unavailable') return { status: 'blocked', reason: accounting.reason === 'checkpoint_changed_retry' ? 'demo_accounting_checkpoint_busy' : 'demo_bot_risk_attribution_unconfirmed', attributionReason: accounting.reason };
    if (budget !== undefined) {
      const currentBaseline = await persistence.getDemoBaselineCandidate();
      if (!currentBaseline || currentBaseline.observedAt.getTime() !== baseline.observedAt.getTime() ||
        !sameDemoAccount(currentBaseline.evidence.accountIdentity, account.identity)) return { status: 'blocked', reason: 'demo_bot_risk_basis_changed' };
    }
    const snapshot = await executor.getAccountSnapshot();
    let equity: number;
    let pnl: { realizedPnlUsdt: number; unrealizedPnlUsdt: number } | undefined;
    if (budget !== undefined && accounting) {
      const result = botRiskEquity(budget, accounting, snapshot, Date.now());
      if (result.status !== 'confirmed') return { status: 'blocked', reason: 'demo_bot_risk_attribution_unconfirmed', attributionReason: result.reason };
      equity = result.equity;
      pnl = result;
    } else {
      const { equityUsdt: total, quoteFree: free } = snapshot;
      if (total === null || free === null || !Number.isFinite(total) || !Number.isFinite(free) || total <= 0 || free < 0 || free > total) return { status: 'blocked', reason: 'demo_balance_unconfirmed' };
      equity = total;
    }
    const observedAt = Date.now();
    const basis = budget === undefined ? undefined : { budgetUsdt: budget, baselineAt: baseline.observedAt.getTime() };
    const key = `${account.identity.mainUid}:${account.identity.uid}${basis ? ':bot-equity-v1' : ''}`;
    const state = basis
      ? await persistence.observeDemoRisk(key, equity, observedAt, basis)
      : await persistence.observeDemoRisk(key, equity, observedAt);
    const reason = demoRiskBlock(state, maxDailyLoss, maxDrawdown);
    const riskEvidence: DemoRiskEvidence = {
      scope: basis ? 'bot' : 'account', observedAt, equityUsdt: state.equity,
      dayStartEquityUsdt: state.dayStartEquity, peakEquityUsdt: state.peakEquity,
      dailyLossRate: (state.dayStartEquity - state.equity) / state.dayStartEquity,
      drawdownRate: (state.peakEquity - state.equity) / state.peakEquity, maxDailyLoss, maxDrawdown,
      ...(basis ? { budgetUsdt: basis.budgetUsdt, baselineAt: basis.baselineAt } : {}),
      ...(pnl ? { realizedPnlUsdt: pnl.realizedPnlUsdt, unrealizedPnlUsdt: pnl.unrealizedPnlUsdt } : {}),
    };
    return reason ? { status: 'blocked', reason, riskEvidence } : { status: 'safe' };
  } catch (error) { return { status: 'blocked', reason: error instanceof DemoRiskBasisChangedError ? 'demo_bot_risk_basis_changed' : 'demo_equity_risk_unconfirmed' }; }
}
