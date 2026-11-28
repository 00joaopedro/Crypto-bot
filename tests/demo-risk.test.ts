import { expect, it } from 'vitest';
import { advanceDemoRisk, demoRiskBlock } from '../src/demo-risk.js';
it('preserves drawdown across restart and resets only the daily reference on a new UTC day', () => {
  const first = advanceDemoRisk(null, 100, Date.UTC(2026,10,1,12));
  const restored = JSON.parse(JSON.stringify(first));
  const loss = advanceDemoRisk(restored, 90, Date.UTC(2026,10,1,13));
  expect(demoRiskBlock(loss, 0.05, 0.2)).toBe('demo_daily_loss_limit');
  const nextDay = advanceDemoRisk(loss, 90, Date.UTC(2026,10,2,1));
  expect(nextDay.dayStartEquity).toBe(90);
  expect(nextDay.peakEquity).toBe(100);
  expect(demoRiskBlock(nextDay, 0.05, 0.09)).toBe('demo_drawdown_limit');
  expect(() => advanceDemoRisk(nextDay, 100, first.observedAt)).toThrow();
});


it('keeps the bot basis and peak through restart and day rollover, even at exhausted equity', () => {
  const at = Date.UTC(2026,10,20,12);
  const basis = { budgetUsdt: 5000, baselineAt: at - 1000 };
  const first = advanceDemoRisk(null, 4999.91, at, basis);
  expect(first.dayStartEquity).toBe(5000);
  expect(first.peakEquity).toBe(5000);
  const restart = advanceDemoRisk(JSON.parse(JSON.stringify(first)), 4849, at + 1000, basis);
  expect(demoRiskBlock(restart, .03, .1)).toBe('demo_daily_loss_limit');
  const next = advanceDemoRisk(restart, 4499, at + 86_400_000, basis);
  expect(next.dayStartEquity).toBe(4499);
  expect(demoRiskBlock(next, .03, .1)).toBe('demo_drawdown_limit');
  const exhausted = advanceDemoRisk(next, -1, at + 86_401_000, basis);
  const followingDay = advanceDemoRisk(exhausted, -1, at + 2 * 86_400_000, basis);
  expect(followingDay.dayStartEquity).toBeGreaterThan(0);
  expect(demoRiskBlock(followingDay, .03, .1)).toBe('demo_daily_loss_limit');
  expect(() => advanceDemoRisk(first, 6000, at + 1000, { ...basis, budgetUsdt: 6000 })).toThrow(/basis changed/);
  expect(() => advanceDemoRisk(first, 5000, at + 1000, { ...basis, baselineAt: at })).toThrow(/basis changed/);
  expect(() => advanceDemoRisk(first, 5000, at + 1000)).toThrow(/basis changed/);
});
