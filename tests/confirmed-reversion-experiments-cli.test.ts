import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { semanticHash } from '../src/cost-experiments.js';
import { CONFIRMED_REVERSION_VARIANTS } from '../src/confirmed-reversion-experiments.js';
import { CONFIRMED_REVERSION_RULES } from '../src/confirmed-mean-reversion.js';
import { universeStudySchema, datasetHash } from '../src/universe-comparison.js';
it('runs the complete fixed matrix offline, retains all failed attempts and verifies source hashes', () => {
  const root = mkdtempSync(join(tmpdir(), 'confirmed-reversion-experiments-'));
  try {
    const dataDir = join(root, 'data'), referenceDir = join(root, 'reference'), out = join(root, 'out');
    mkdirSync(dataDir); mkdirSync(referenceDir);
    const original = JSON.parse(readFileSync(new URL('../examples/universe-validation.study.json', import.meta.url), 'utf8'));
    const symbols = ['BTC/USDT', 'ETH/USDT'];
    const costs = Object.fromEntries(symbols.map(s => [s, { feeRate: .004, slippageRate: .001, spreadRate: .0015, entryFeeCurrency: 'base' }]));
    const study = universeStudySchema.parse({ ...original, sizes: [10, 30], scenarios: original.scenarios.slice(0, 2).map((s: any, i: number) => ({ ...s, symbolCosts: Object.fromEntries(Object.entries(costs).map(([k, c]) => [k, { ...c, feeRate: .004 * (i + 1) }])) })) });
    const end = Date.parse(study.endExclusiveUtc), length = study.warmupCandles + 2880;
    const assets = symbols.map(symbol => {
      const dataset = { symbol, constraints: { minimumNotionalUsdt: 0, minimumQuantity: .001, quantityStep: .001 }, quoteVolumesUsdt: Array(length).fill(2e6), candles: Array.from({ length }, (_, i) => ({ timestamp: end - (length - i) * 900000, open: 100, high: 100.1, low: 99.9, close: 100, volume: 20000 })) };
      const filename = symbol.replace('/', '-') + '.json'; writeFileSync(join(dataDir, filename), JSON.stringify(dataset));
      return { symbol, filename, sha256: datasetHash(dataset) };
    });
    const sourceHash = 'a'.repeat(64), studyHash = semanticHash(study);
    const plan = { protocol: 'confirmed-reversion-development-v1', referenceStudySha256: studyHash, sourceStudySha256: sourceHash, sizes: [10, 30], minimumClosedTradesPerRun: 30, variants: CONFIRMED_REVERSION_VARIANTS, rules: CONFIRMED_REVERSION_RULES };
    const planPath = join(root, 'plan.json'); writeFileSync(planPath, JSON.stringify(plan));
    const source = JSON.stringify({ complete: true, studySha256: sourceHash, assets }); writeFileSync(join(dataDir, 'source.json'), source);
    writeFileSync(join(referenceDir, 'study.json'), JSON.stringify(study));
    writeFileSync(join(referenceDir, 'summary.json'), JSON.stringify({ studySha256: studyHash, sourceStudySha256: sourceHash, datasetHashes: assets.map(({ symbol, sha256 }) => ({ symbol, sha256 })), coverage: { symbols: 2, feeEvidenced: 0, feesAssumed: 2 }, scenarios: [10, 30].map(size => ({ size, results: study.scenarios.map(s => ({ scenario: s.name, netReturnUsdt: 0, profitFactor: null, closedTrades: 0, maxDrawdownUsdt: 0 })) })) }));
    const run = (output = out) => execFileSync(process.execPath, ['--import', 'tsx', new URL('../src/confirmed-reversion-experiments-cli.ts', import.meta.url).pathname, planPath, dataDir, referenceDir, output], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const result = JSON.parse(run()); expect(result.results).toHaveLength(8);
    expect(result.results.every((r: any) => r.closedTrades === 0)).toBe(true);
    expect(result.readiness).toMatchObject({ status: 'blocked_no_eligible_candidate', realMoneyApproved: false, configurationPromoted: false });
    expect(result.variants).toHaveLength(2);
    expect(result.diagnostics).toHaveLength(8);
    expect(semanticHash(result.referenceStudy)).toBe(studyHash);
    expect(readFileSync(join(dataDir, 'source.json'), 'utf8')).toBe(source);
    expect(() => run(referenceDir)).toThrow(/replace/);
    const archivedPath = join(referenceDir, 'summary.json'), archived = JSON.parse(readFileSync(archivedPath, 'utf8'));
    archived.scenarios[0].results[0].netReturnUsdt = 1; writeFileSync(archivedPath, JSON.stringify(archived));
    expect(run).toThrow(/differs from archived/);
    archived.scenarios[0].results[0].netReturnUsdt = 0; writeFileSync(archivedPath, JSON.stringify(archived));
    writeFileSync(join(dataDir, assets[0]!.filename), '{}'); expect(run).toThrow(/hash mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 20000);
