import type { OkxDemoAccountSnapshot } from './okx-demo.js';

export type DemoRiskAccounting = { status: 'unavailable'; reason: string } | {
  status: 'confirmed'; realizedPnlUsdt: number; confirmedThrough: number;
  positions: Record<string, { quantity: number; costUsdt: number }>;
};
export type DemoRiskOptions = { botBudgetUsdt?: number; inspectAccounting?: () => Promise<DemoRiskAccounting> };

/** Only the fee-adjusted, owned ledger enters equity; wallet balances are not P&L. */
export function botRiskEquity(budget: number, accounting: DemoRiskAccounting,
  snapshot: OkxDemoAccountSnapshot, now: number):
  { status: 'confirmed'; equity: number; realizedPnlUsdt: number; unrealizedPnlUsdt: number } |
  { status: 'unavailable'; reason: string } {
  const no = (reason: string) => ({ status: 'unavailable' as const, reason });
  if (!Number.isFinite(budget) || budget <= 0) return no('invalid_bot_budget');
  if (accounting.status !== 'confirmed') return no(accounting.reason);
  const snapshotAt = Date.parse(snapshot.updatedAt);
  if (!Number.isSafeInteger(accounting.confirmedThrough) || accounting.confirmedThrough <= 0 ||
    now - accounting.confirmedThrough > 120_000 || accounting.confirmedThrough - now > 10_000 ||
    !Number.isFinite(snapshotAt) || now - snapshotAt > 120_000 || snapshotAt - now > 10_000) return no('risk_evidence_stale');
  if (!Number.isFinite(accounting.realizedPnlUsdt)) return no('invalid_bot_pnl');
  let unrealized = 0;
  for (const [symbol, position] of Object.entries(accounting.positions)) {
    const [base, quote, extra] = symbol.split('/');
    if (!base || quote !== 'USDT' || extra !== undefined || !Number.isFinite(position.quantity) ||
      position.quantity < 0 || !Number.isFinite(position.costUsdt) || position.costUsdt < 0) return no('invalid_bot_position');
    if (position.quantity === 0) {
      if (position.costUsdt !== 0) return no('invalid_bot_position');
      continue;
    }
    const price = snapshot.assetUnitValuesUsdt?.[base];
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || snapshot.unvaluedAssets.includes(base)) return no('bot_position_mark_unconfirmed');
    unrealized += position.quantity * price - position.costUsdt;
  }
  const equity = budget + accounting.realizedPnlUsdt + unrealized;
  if (!Number.isFinite(unrealized) || !Number.isFinite(equity)) return no('invalid_bot_equity');
  return { status: 'confirmed', equity, realizedPnlUsdt: accounting.realizedPnlUsdt, unrealizedPnlUsdt: unrealized };
}
