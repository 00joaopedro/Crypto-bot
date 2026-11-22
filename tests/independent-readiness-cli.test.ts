import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
const command = (...args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', new URL('../src/independent-validation-cli.ts', import.meta.url).pathname, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const inputs = ['docs/cost-aware-experiments.json', 'docs/financial-reference-current.json', 'examples/universe-validation.study.json'];
it('handles current and legacy evidence without declaring a blocked screen to be a passed test', () => {
  const current = JSON.parse(command(...inputs));
  expect(current).toMatchObject({ status: 'blocked_no_eligible_candidate', holdoutExecuted: false, realMoneyApproved: false });
  expect(JSON.parse(command('docs/limited-experiments.json')).status).toBe('blocked_no_eligible_candidate');
  expect(() => command(inputs[0]!)).toThrow(/requires financial/);
  expect(() => command(...inputs, '/independent-data-must-not-be-opened.json')).toThrow(/No eligible/);
}, 15000);
