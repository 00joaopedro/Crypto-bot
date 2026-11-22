import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exitPolicySchema } from "../src/exit-policy.js";
import { PaperTrader } from "../src/paper-trader.js";
import { screenResearchEntry } from "../src/research-entry-screen.js";
import { COST_EXPERIMENT_VARIANTS, costExperimentStudies, costExperimentPlanSchema, screenCostExperiments, semanticHash, type CostExperimentRow } from "../src/cost-experiments.js";
import { universeStudySchema } from "../src/universe-comparison.js";
const plan = JSON.parse(readFileSync(new URL('../examples/cost-experiments.plan.json', import.meta.url), 'utf8'));
const costs = { feeRate: .004, slippageRate: .001, spreadRate: .0015, entryFeeCurrency: 'base' as const };
const policy = exitPolicySchema.parse({ mode: 'fixed' });
const parameters = { exitPolicy: policy, stopLossRate: .01, takeProfitRate: .02, minimumSignalScore: 4, maxBuyRsi: 70, executionDelayCandles: 1 };
const candles = Array.from({ length: 100 }, (_, i) => ({ timestamp: i * 900000, open: 100, close: 100, high: 100.6, low: 99.4, volume: 10000 }));
const standard = { name: 'account', feeRate: costs.feeRate, slippageRate: costs.slippageRate, spreadRate: costs.spreadRate, assumedDepthUsdt: 1000, maxParticipationRate: .001, symbolCosts: { 'BTC/USDT': costs } };
function reference() {
  const original = JSON.parse(readFileSync(new URL('../examples/universe-validation.study.json', import.meta.url), 'utf8'));
  return universeStudySchema.parse({ ...original, sizes: [10, 30], parameters, scenarios: [standard, { ...standard, name: 'stress', feeRate: .008, symbolCosts: { 'BTC/USDT': { ...costs, feeRate: .008 } } }] });
}
function goodRows(): CostExperimentRow[] {
  return COST_EXPERIMENT_VARIANTS.flatMap(v => [10, 30].flatMap(size => ['account', 'stress'].map(scenario => ({ variant: v.name, size, scenario,
    netReturnUsdt: 10, realizedPnlUsdt: 10, profitFactor: 2, closedTrades: 40, expectancyUsdt: .25, maxDrawdownUsdt: 3, recoveryFactor: 10 / 3,
    top3TradesProfitSharePercent: 20, realizedPnlWithoutTop3Usdt: 7, blocks: [{ netReturnUsdt: 4, closedTrades: 20, profitFactor: 2 }, { netReturnUsdt: 6, closedTrades: 20, profitFactor: 2 }] }))));
}
describe('bounded cost-aware development experiments', () => {
  it('defines exactly five alternatives and refuses undeclared parameter fishing', () => {
    expect(costExperimentPlanSchema.parse(plan).variants).toEqual(COST_EXPERIMENT_VARIANTS);
    const changed = structuredClone(plan); changed.variants[2].minimumTargetCostMultiple = 1.1;
    expect(() => costExperimentPlanSchema.parse(changed)).toThrow(/predeclared/);
    expect(() => costExperimentPlanSchema.parse({ ...plan, sizes: [10, 100] })).toThrow();
  });
  it('changes one entry factor only and preserves all capital, exits and costs', () => {
    const study = reference(), ownPlan = { ...plan, referenceStudySha256: semanticHash(study) };
    const result = costExperimentStudies(study, ownPlan);
    for (const v of result.variants) {
      expect(v.study.scenarios).toEqual(study.scenarios); expect(v.study.portfolio).toEqual(study.portfolio);
      expect(v.study.initialBalanceUsdt).toBe(study.initialBalanceUsdt); expect(v.study.tradeSizeUsdt).toBe(study.tradeSizeUsdt);
      expect(v.study.parameters.exitPolicy).toEqual(study.parameters.exitPolicy);
    }
    expect(result.variants[1]!.study.parameters.maxBuyRsi).toBe(63);
    expect(result.variants[2]!.screen).toEqual({ minimumTargetCostMultiple: 1.5 });
    expect(() => costExperimentStudies({ ...study, tradeSizeUsdt: 20 }, ownPlan)).toThrow(/hash/);
  });
  it('calculates fee-in-base break-even from both legs and matches a cash round trip', () => {
    const result = screenResearchEntry(candles, parameters, costs, { minimumTargetCostMultiple: 2 });
    const effective = (1 + costs.slippageRate) * (1 + costs.spreadRate / 2) - 1;
    expect(result.breakEvenMoveRate).toBeCloseTo((1 + effective) / (1 - effective) / (1 - costs.feeRate) ** 2 - 1, 12);
    const trader = new PaperTrader({ initialBalanceUsdt: 100, tradeSizeUsdt: 10, feeRate: costs.feeRate, entryFeeCurrency: costs.entryFeeCurrency, slippageRate: effective, stopLossRate: .5, takeProfitRate: .5 });
    trader.processCandle(candles[0]!, true);
    const price = 100 * (1 + result.breakEvenMoveRate);
    const { events } = trader.processCandle({ ...candles[1]!, open: price, high: price, low: price, close: price }, false, undefined, true);
    expect(events[0]).toMatchObject({ type: 'CLOSED' });
    expect((events[0] as any).netPnlUsdt).toBeCloseTo(0, 10);
  });
  it('accounts for quote fee without borrowing the base-fee formula or subtracting twice', () => {
    const result = screenResearchEntry(candles, parameters, { ...costs, entryFeeCurrency: 'quote' }, { minimumTargetCostMultiple: 2 });
    const effective = (1 + costs.slippageRate) * (1 + costs.spreadRate / 2) - 1;
    expect(result.breakEvenMoveRate).toBeCloseTo((1 + effective) / (1 - effective) * (1 + costs.feeRate) / (1 - costs.feeRate) - 1, 12);
  });
  it('becomes stricter across neighboring multiples and higher pair costs, with zero-cost handling', () => {
    const decisions = [1.5, 2, 2.5].map(minimumTargetCostMultiple => screenResearchEntry(candles, parameters, costs, { minimumTargetCostMultiple }));
    expect(decisions.map(r => r.allowed)).toEqual([true, true, true]);
    const lowVol = candles.map(c => ({ ...c, high: 100.1, low: 99.9 }));
    expect(screenResearchEntry(lowVol, parameters, costs, { minimumTargetCostMultiple: 2 }).allowed).toBe(false);
    expect(screenResearchEntry(candles, parameters, { ...costs, feeRate: .02 }, { minimumTargetCostMultiple: 2 }).allowed).toBe(false);
    expect(screenResearchEntry(candles, parameters, { ...costs, feeRate: 0, spreadRate: 0, slippageRate: 0 }, { minimumTargetCostMultiple: 2 })).toMatchObject({ allowed: true, breakEvenMoveRate: 0, targetCostMultiple: null });
    expect(() => screenResearchEntry(candles, { ...parameters, exitPolicy: { ...policy, mode: 'trailing_atr' } }, costs, { minimumTargetCostMultiple: 2 })).toThrow(/fixed/);
  });
  it('blocks the least negative result, zero trades, a bad block, top-three dependence and incomplete matrices', () => {
    const negative = goodRows(); negative.forEach(r => { r.netReturnUsdt = -.01; });
    expect(screenCostExperiments(negative, ['account', 'stress']).status).toBe('blocked_no_eligible_candidate');
    const empty = goodRows(); empty.forEach(r => { r.closedTrades = 0; });
    expect(screenCostExperiments(empty, ['account', 'stress']).status).toBe('blocked_no_eligible_candidate');
    const bad = goodRows(); bad.forEach(r => { r.blocks[1]!.netReturnUsdt = -1; });
    expect(screenCostExperiments(bad, ['account', 'stress']).status).toBe('blocked_no_eligible_candidate');
    const lucky = goodRows(); lucky.forEach(r => { r.realizedPnlWithoutTop3Usdt = -1; });
    expect(screenCostExperiments(lucky, ['account', 'stress']).status).toBe('blocked_no_eligible_candidate');
    expect(() => screenCostExperiments(goodRows().slice(1), ['account', 'stress'])).toThrow(/matrix/);
    const duplicate = goodRows(); duplicate[1] = duplicate[0]!;
    expect(() => screenCostExperiments(duplicate, ['account', 'stress'])).toThrow(/matrix/);
  });
  it('requires a new independent protocol even on synthetic passing results and checks all three neighbors', () => {
    const rows = goodRows(); const first = screenCostExperiments(rows, ['account', 'stress']);
    expect(first).toMatchObject({ status: 'independent_protocol_required', costFamilyStable: true, holdoutExecuted: false, configurationPromoted: false, realMoneyApproved: false });
    rows.find(r => r.variant === 'cost-buffer-2.5' && r.scenario === 'stress')!.netReturnUsdt = -1;
    expect(screenCostExperiments(rows, ['account', 'stress']).costFamilyStable).toBe(false);
  });
});
