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
