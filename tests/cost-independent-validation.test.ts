import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { assessCostIndependentReadiness as assess, prepareCostIndependentFreeze as freeze } from "../src/cost-independent-validation.js";
const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const inputs = () => ({ evidence: read('../docs/cost-aware-experiments.json'), financial: read('../docs/financial-reference-current.json'), source: read('../examples/universe-validation.study.json') });
function positive() {
  const data = inputs();
  for (const row of data.evidence.results) Object.assign(row, { netReturnUsdt: 10, realizedPnlUsdt: 10, profitFactor: 2, closedTrades: 40, expectancyUsdt: .25, maxDrawdownUsdt: 3,
    recoveryFactor: 10 / 3, top3TradesProfitSharePercent: 15, realizedPnlWithoutTop3Usdt: 7,
    blocks: [{ netReturnUsdt: 4, closedTrades: 20, profitFactor: 2 }, { netReturnUsdt: 6, closedTrades: 20, profitFactor: 2 }] });
  for (const u of data.financial.scenarios) for (const row of u.results) {
    const e = data.evidence.results.find((r: any) => r.variant === 'reference' && r.size === u.size && r.scenario === row.scenario);
    Object.assign(row, { netReturnUsdt: e.netReturnUsdt, profitFactor: e.profitFactor, closedTrades: e.closedTrades, maxDrawdownUsdt: e.maxDrawdownUsdt, blocks: structuredClone(e.blocks) });
  }
  return data;
}
function protocol(data: ReturnType<typeof inputs>) {
  const result = assess(data.evidence, data.financial, data.source);
  return { schemaVersion: 1, purpose: 'independent_offline_protocol', codeCommit: 'a'.repeat(40), candidate: 'cost-buffer-2', evidenceHash: result.evidenceHash, financialReferenceHash: result.financialReferenceHash,
    evaluationStartUtc: '2026-09-07T00:00:00.000Z', evaluationEndExclusiveUtc: '2026-09-27T00:00:00.000Z', warmupCandles: 672,
    otherInspectedWindows: [], inspectionRegistryDeclaredComplete: true, independentDataDeclaredUninspected: true,
    acceptance: { positiveMarkedAndRealizedResultEachBlock: true, minimumClosedTradesPerBlock: 30, minimumProfitFactorEachBlock: 1.25, costsAndRiskUnchanged: true } };
}
it('blocks all five actual candidates, records the consulted warmup and consumes no independent sample', () => {
  const d = inputs(), r = assess(d.evidence, d.financial, d.source);
  expect(r).toMatchObject({ status: 'blocked_no_eligible_candidate', holdoutExecuted: false, configurationPromoted: false, realMoneyApproved: false });
  expect(r.candidates).toHaveLength(5); expect(r.candidates.every(c => !c.readyToFreeze)).toBe(true);
  expect(r.consultedDevelopmentWindow).toEqual({ startUtc: '2026-07-25T00:00:00.000Z', endExclusiveUtc: '2026-08-31T00:00:00.000Z', includesWarmup: true });
  expect(r.feeEvidenceCoverage).toMatchObject({ feeEvidenced: 6, feesAssumed: 114 });
});
it('recomputes the screen instead of trusting claimed pass, promotion or real-money flags', () => {
  const d = inputs(); d.evidence.readiness = { status: 'approved', realMoneyApproved: true }; d.evidence.secretNotForOutput = 'DO_NOT_COPY';
  const r = assess(d.evidence, d.financial, d.source);
  expect(r.status).toBe('blocked_no_eligible_candidate'); expect(r.realMoneyApproved).toBe(false);
  expect(JSON.stringify(r)).not.toContain('DO_NOT_COPY');
  expect(() => freeze({}, d.evidence, d.financial, d.source)).toThrow(/No eligible/);
});
it('rejects a different source, protocol, pool, configuration or fee coverage', () => {
  const d = inputs();
  const source = structuredClone(d.source); source.endExclusiveUtc = '2026-09-30T00:00:00Z';
  expect(() => assess(d.evidence, d.financial, source)).toThrow(/hash mismatch/);
  const changed = structuredClone(d.evidence); changed.protocolSha256 = '0'.repeat(64);
  expect(() => assess(changed, d.financial, d.source)).toThrow(/hash mismatch/);
  const pool = structuredClone(d.evidence); pool.datasetHashes[0].sha256 = '0'.repeat(64);
  expect(() => assess(pool, d.financial, d.source)).toThrow(/dataset identity/);
  const config = structuredClone(d.evidence); config.referenceConfigurationHash = '0'.repeat(64);
  expect(() => assess(config, d.financial, d.source)).toThrow(/configuration/);
  const fees = structuredClone(d.evidence); fees.feeEvidenceCoverage.feeEvidenced = 120;
  expect(() => assess(fees, d.financial, d.source)).toThrow(/coverage/);
});
it('refuses inconsistent numerical claims, missing matrix rows, duplicates and altered baseline', () => {
  const d = inputs();
  const inconsistent = structuredClone(d.evidence); inconsistent.results[4].expectancyUsdt += 1;
  expect(() => assess(inconsistent, d.financial, d.source)).toThrow(/Inconsistent/);
  const blocks = structuredClone(d.evidence); blocks.results[4].blocks[0].netReturnUsdt += 1;
  expect(() => assess(blocks, d.financial, d.source)).toThrow(/Inconsistent/);
  const recovery = structuredClone(d.evidence); recovery.results[4].recoveryFactor = 10;
  expect(() => assess(recovery, d.financial, d.source)).toThrow(/Inconsistent/);
  const partial = structuredClone(d.evidence); partial.results.pop();
  expect(() => assess(partial, d.financial, d.source)).toThrow();
  const dup = structuredClone(d.evidence); dup.results[1] = dup.results[0];
  expect(() => assess(dup, d.financial, d.source)).toThrow(/matrix/);
  const financial = structuredClone(d.financial); financial.scenarios[0].results[0].profitFactor = 2;
  expect(() => assess(d.evidence, financial, d.source)).toThrow(/baseline/);
});
it('allows only protocol preparation on synthetic positive evidence, with no independent or real approval', () => {
  const d = positive(), r = assess(d.evidence, d.financial, d.source);
  expect(r).toMatchObject({ status: 'frozen_protocol_required', costFamilyStable: true, holdoutExecuted: false, realMoneyApproved: false });
  expect(r.candidates.find(c => c.variant === 'rsi-63')).toMatchObject({ readyToFreeze: false, freezeBlockers: ['single_rsi_threshold_stability_not_verified'] });
  const ready = freeze(protocol(d), d.evidence, d.financial, d.source);
  expect(ready).toMatchObject({ status: 'frozen_protocol_only', holdoutExecuted: false, configurationPromoted: false, realMoneyApproved: false });
  expect(ready.frozen.warmupStartUtc).toBe('2026-08-31T00:00:00.000Z');
  expect(ready.frozen.independenceStatus).toBe('declared_not_independently_verified');
  expect(ready.frozen.referenceStudySha256).toBe(d.evidence.referenceStudySha256);
  expect(ready.frozen).toMatchObject({ timeframe: '15m', executionMode: 'offline-only' });
});
it('blocks costs with a failed neighboring threshold and blocks the single RSI alternative', () => {
  const d = positive();
  const row = d.evidence.results.find((r: any) => r.variant === 'cost-buffer-2.5'); row.closedTrades = 20; row.expectancyUsdt = .5; row.blocks.forEach((b: any) => { b.closedTrades = 10; });
  const r = assess(d.evidence, d.financial, d.source);
  expect(r.costFamilyStable).toBe(false); expect(r.candidates.find(c => c.variant === 'cost-buffer-2')!.readyToFreeze).toBe(false);
  const p = protocol(d); expect(() => freeze(p, d.evidence, d.financial, d.source)).toThrow(/not eligible/);
  const good = positive(); const rsi = { ...protocol(good), candidate: 'rsi-63' };
  expect(() => freeze(rsi, good.evidence, good.financial, good.source)).toThrow(/not eligible/);
});
it('rejects overlap through warmup, other inspected windows, misalignment, insufficient warmup and stale hashes', () => {
  const d = positive(), p = protocol(d);
  const overlapping = { ...p, evaluationStartUtc: '2026-09-02T00:00:00.000Z', evaluationEndExclusiveUtc: '2026-09-22T00:00:00.000Z' };
  expect(() => freeze(overlapping, d.evidence, d.financial, d.source)).toThrow(/overlaps/);
  const extra = { ...p, otherInspectedWindows: [{ startUtc: '2026-09-01T00:00:00.000Z', endExclusiveUtc: '2026-09-03T00:00:00.000Z' }] };
  expect(() => freeze(extra, d.evidence, d.financial, d.source)).toThrow(/overlaps/);
  expect(() => freeze({ ...p, evaluationStartUtc: '2026-09-07T00:01:00.000Z' }, d.evidence, d.financial, d.source)).toThrow(/aligned/);
  expect(() => freeze({ ...p, warmupCandles: 100 }, d.evidence, d.financial, d.source)).toThrow(/warmup/);
  expect(() => freeze({ ...p, evidenceHash: '0'.repeat(64) }, d.evidence, d.financial, d.source)).toThrow(/hash mismatch/);
});
