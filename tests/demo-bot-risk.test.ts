import { describe, expect, it, vi } from 'vitest';
import { inspectDemoEntry, inspectDemoEquityRisk } from '../src/demo-entry.js';
import { inspectDemoResume } from '../src/demo-resume.js';
import { inspectDemoAccounting } from '../src/demo-diagnostic.js';
import { advanceDemoRisk, type DemoRiskBasis, type DemoRiskState } from '../src/demo-risk.js';
import { calculateDemoLedger } from '../src/demo-ledger.js';
import { autoResumeAt } from '../src/auto-resume.js';

const identity = { uid: '123', mainUid: '123' };
function setup() {
  const now = Date.now();
  const baseline = { observedAt: new Date(now - 120_000), balances: { USDT: 5000, BTC: 1, ETH: 1 },
    evidence: { accountIdentity: identity, startedAt: now - 121_000 }, status: 'UNVERIFIED' };
  const states = new Map<string, DemoRiskState>();
  const observeDemoRisk = vi.fn(async (key: string, equity: number, at: number, basis?: DemoRiskBasis) => {
    const state = advanceDemoRisk(states.get(key) ?? null, equity, at, basis);
    states.set(key, JSON.parse(JSON.stringify(state)));
    return state;
  });
  const persistence = { observeDemoRisk, getDemoBaselineCandidate: async () => baseline,
    demoOrderJournal: async () => [], saveDemoAccountingCheckpoint: vi.fn(async () => true),
    readDemoEntryRevision: async () => '1:1', canEnterDemoSymbol: async () => true };
  let balances = { ...baseline.balances };
  const executor = { inspectAccountIdentity: async () => ({ status: 'confirmed' as const, identity }),
    inspectTradingPermission: async () => ({ status: 'available' as const, trading: true }),
    collectOrderEvidence: vi.fn(), collectFillHistory: vi.fn(),
    collectAccountCoverage: vi.fn(async () => ({ status: 'covered' as const, billCount: 0 })),
    collectAccountBalances: async () => ({ status: 'collected' as const, startedAt: Date.now() - 10,
      endedAt: Date.now(), balances }),
    getAccountSnapshot: vi.fn(async () => ({ equityUsdt: 80_000, quoteFree: 5000,
      totalUsdt: 5000, quoteCurrency: 'USDT', unvaluedAssets: [] as string[],
      assetUnitValuesUsdt: { BTC: 65_000, ETH: 1800, NEAR: 3 }, updatedAt: new Date().toISOString() })),
  };
  const options = { botBudgetUsdt: 5000, inspectAccounting: () => inspectDemoAccounting(persistence, executor) };
  const check = () => inspectDemoEquityRisk(persistence, executor, .03, .1, options);
  return { baseline, states, persistence, executor, options, check, setBalances: (value: typeof balances) => { balances = value; } };
}

describe('attributed Demo risk', () => {
  it('ignores price changes of initial BTC/ETH, separates the old account latch and admits a valid entry', async () => {
    const s = setup();
    s.states.set('123:123', advanceDemoRisk(null, 100_000, Date.now() - 1000));
    expect(await s.check()).toEqual({ status: 'safe' });
    const originalSnapshot = await s.executor.getAccountSnapshot();
    s.executor.getAccountSnapshot.mockResolvedValue({ ...originalSnapshot, equityUsdt: 60_000,
      assetUnitValuesUsdt: { ...originalSnapshot.assetUnitValuesUsdt, BTC: 45_000 } });
    expect(await s.check()).toEqual({ status: 'safe' });
    expect(s.states.get('123:123')?.equity).toBe(100_000);
    expect(s.states.get('123:123:bot-equity-v1')?.equity).toBe(5000);
    expect(await inspectDemoEntry(s.persistence, s.executor, { ...s.options, symbol: 'NEAR/USDT', size: 10,
      stopLossRate: .01, cooldownMinutes: 60, maxPositions: 10, maxExposure: .1,
      riskPerTrade: .005, maxDailyLoss: .03, maxDrawdown: .1 })).toMatchObject({ allowed: true });
  });

  it.each([100, -100])('does not classify a %i USDT deposit/withdrawal as bot P&L or advance the risk state', async change => {
    const s = setup();
    await s.check();
    const before = JSON.stringify([...s.states]);
    s.setBalances({ ...s.baseline.balances, USDT: 5000 + change });
    const result = await s.check();
    expect(result).toMatchObject({ status: 'blocked', reason: 'demo_bot_risk_attribution_unconfirmed', attributionReason: 'balance_changed_since_checkpoint' });
    expect(result).not.toHaveProperty('riskEvidence');
    expect(JSON.stringify([...s.states])).toBe(before);
    expect(s.persistence.observeDemoRisk).toHaveBeenCalledTimes(1);
  });

  it('blocks unattributed bills and missing accounting instead of falling back to the wallet', async () => {
    const s = setup();
    s.executor.collectAccountCoverage.mockResolvedValueOnce({ status: 'unavailable', reason: 'unattributed_account_bill' } as never);
    expect(await s.check()).toMatchObject({ reason: 'demo_bot_risk_attribution_unconfirmed', attributionReason: 'unattributed_account_bill' });
    expect(await inspectDemoEquityRisk(s.persistence, s.executor, .03, .1, { botBudgetUsdt: 5000 }))
      .toMatchObject({ reason: 'demo_bot_risk_attribution_unconfirmed' });
    expect(s.persistence.observeDemoRisk).not.toHaveBeenCalled();
  });

  it('counts base fees and unrealized loss only on the bot-owned net position, including dust', async () => {
    const s = setup();
    const ledger = calculateDemoLedger([{ id: 'f1', orderId: 'b1', symbol: 'NEAR/USDT', side: 'buy',
      timestamp: Date.now() - 1000, amount: 100, costUsdt: 300, fees: [{ currency: 'NEAR', cost: .4 }] }], true);
    if (ledger.status !== 'confirmed') throw new Error('invalid fixture');
    const inspectAccounting = async () => ({ ...ledger, confirmedThrough: Date.now() });
    const options = { ...s.options, inspectAccounting };
    const result = await inspectDemoEquityRisk(s.persistence, s.executor, .0001, .1, options);
    expect(result).toMatchObject({ reason: 'demo_daily_loss_limit', riskEvidence: {
      scope: 'bot', equityUsdt: 4998.8, realizedPnlUsdt: 0,
      unrealizedPnlUsdt: expect.closeTo(-1.2), dayStartEquityUsdt: 5000,
    } });
    // A tiny fee-adjusted residual remains a costed position; it is never silently discarded.
    const residual = await inspectDemoEquityRisk(s.persistence, s.executor, .03, .1, {
      ...s.options, inspectAccounting: async () => ({ status: 'confirmed', confirmedThrough: Date.now(),
        realizedPnlUsdt: -.09, positions: { 'NEAR/USDT': { quantity: 5e-9, costUsdt: 2e-8 } } }),
    });
    expect(residual).toEqual({ status: 'safe' });
    expect(s.states.get('123:123:bot-equity-v1')?.equity).toBeCloseTo(4999.91);
  });

  it('enforces actual bot losses on resume and admission, with the numerical evidence', async () => {
    const s = setup();
    const options = { ...s.options, inspectAccounting: async () => ({ status: 'confirmed' as const,
      confirmedThrough: Date.now(), realizedPnlUsdt: -151, positions: {} }) };
    const limits = { ...options, maxDailyLoss: .03, maxDrawdown: .1 };
    const resume = await inspectDemoResume(s.persistence, s.executor, limits);
    expect(resume).toMatchObject({ status: 'blocked', reason: 'demo_daily_loss_limit', riskEvidence: {
      scope: 'bot', budgetUsdt: 5000, equityUsdt: 4849, dayStartEquityUsdt: 5000,
      peakEquityUsdt: 5000, dailyLossRate: .0302, maxDailyLoss: .03,
    } });
    expect(await inspectDemoEntry(s.persistence, s.executor, { ...limits, symbol: 'ETH/USDT', size: 10,
      stopLossRate: .01, cooldownMinutes: 60, maxPositions: 10, maxExposure: .1, riskPerTrade: .005 }))
      .toMatchObject({ allowed: false, reason: 'demo_daily_loss_limit', riskEvidence: { equityUsdt: 4849 } });
  });

  it('rejects stale accounting and absent marks without recording an equity observation', async () => {
    const s = setup();
    for (const data of [
      { confirmedThrough: Date.now() - 121_000, positions: {} },
      { confirmedThrough: Date.now(), positions: { 'UNKNOWN/USDT': { quantity: 1, costUsdt: 10 } } },
    ]) {
      expect(await inspectDemoEquityRisk(s.persistence, s.executor, .03, .1, { ...s.options,
        inspectAccounting: async () => ({ status: 'confirmed', realizedPnlUsdt: 0, ...data }),
      })).toMatchObject({ status: 'blocked', reason: 'demo_bot_risk_attribution_unconfirmed' });
    }
    expect(s.persistence.observeDemoRisk).not.toHaveBeenCalled();
  });

  it('rejects a baseline replaced during reconciliation without writing risk', async () => {
    const s = setup();
    const initial = { ...s.baseline };
    const getDemoBaselineCandidate = vi.fn().mockResolvedValueOnce(initial)
      .mockResolvedValue({ ...initial, observedAt: new Date(initial.observedAt.getTime() + 1) });
    const options = { ...s.options, inspectAccounting: async () => ({ status: 'confirmed' as const,
      confirmedThrough: Date.now(), realizedPnlUsdt: 0, positions: {} }) };
    expect(await inspectDemoEquityRisk({ ...s.persistence, getDemoBaselineCandidate }, s.executor, .03, .1, options))
      .toMatchObject({ reason: 'demo_bot_risk_basis_changed' });
    expect(s.persistence.observeDemoRisk).not.toHaveBeenCalled();
  });

  it('requires review after changing the budget or accounting origin; transient attribution may only be rechecked', async () => {
    const s = setup();
    await s.check();
    expect(await inspectDemoEquityRisk(s.persistence, s.executor, .03, .1, { ...s.options, botBudgetUsdt: 6000 }))
      .toMatchObject({ reason: 'demo_bot_risk_basis_changed' });
    const before = s.baseline.observedAt;
    s.baseline.observedAt = new Date(before.getTime() + 1);
    expect(await s.check()).toMatchObject({ reason: 'demo_bot_risk_basis_changed' });
    const control = { paused: true, revision: '1', updatedBy: 'system:demo_execution_safety',
      updatedAt: new Date(), pauseReason: 'demo_bot_risk_attribution_unconfirmed' };
    expect(autoResumeAt(control, 120, true)).toBe(control.updatedAt.getTime());
    expect(autoResumeAt({ ...control, pauseReason: 'demo_bot_risk_basis_changed' }, 120, true)).toBeNull();
    expect(autoResumeAt({ ...control, updatedBy: 'dashboard' }, 120, true)).toBeNull();
  });
});
