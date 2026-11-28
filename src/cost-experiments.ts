import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { compareUniverseSizes, universeStudySchema, type UniverseDataset } from "./universe-comparison.js";
import type { ResearchEntryScreen } from "./research-entry-screen.js";

export const COST_EXPERIMENT_VARIANTS = [
  { name: "reference", maxBuyRsi: 70, minimumTargetCostMultiple: null },
  { name: "rsi-63", maxBuyRsi: 63, minimumTargetCostMultiple: null },
  { name: "cost-buffer-1.5", maxBuyRsi: 70, minimumTargetCostMultiple: 1.5 },
  { name: "cost-buffer-2", maxBuyRsi: 70, minimumTargetCostMultiple: 2 },
  { name: "cost-buffer-2.5", maxBuyRsi: 70, minimumTargetCostMultiple: 2.5 },
] as const;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const costExperimentPlanSchema = z.object({
  protocol: z.literal("cost-aware-trend-development-v1"),
  referenceStudySha256: sha,
  sourceStudySha256: sha,
  sizes: z.tuple([z.literal(10), z.literal(30)]),
  minimumClosedTradesPerRun: z.literal(30),
  variants: z.array(z.object({ name: z.string(), maxBuyRsi: z.number(), minimumTargetCostMultiple: z.number().nullable() }).strict()).length(5),
}).strict().refine(p => isDeepStrictEqual(p.variants, COST_EXPERIMENT_VARIANTS), "Only the five predeclared one-factor variants are allowed");
export const semanticHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function costExperimentStudies(rawReference: unknown, rawPlan: unknown) {
  const reference = universeStudySchema.parse(rawReference), plan = costExperimentPlanSchema.parse(rawPlan);
  if (semanticHash(reference) !== plan.referenceStudySha256) throw new Error("Financial reference hash mismatch");
  if (!isDeepStrictEqual(reference.sizes, plan.sizes) || reference.parameters.maxBuyRsi !== 70 || reference.parameters.executionDelayCandles !== 1 || !reference.parameters.exitPolicy || reference.parameters.exitPolicy.mode !== "fixed" || reference.parameters.exitPolicy.breakeven || reference.scenarios.length !== 2 || reference.scenarios.some(s => !s.symbolCosts)) throw new Error("Reference must have the frozen sizes, per-pair costs and fixed ATR exits");
  return { plan, reference, variants: plan.variants.map(variant => ({
    name: variant.name,
    study: universeStudySchema.parse({ ...reference, parameters: { ...reference.parameters, maxBuyRsi: variant.maxBuyRsi } }),
    screen: variant.minimumTargetCostMultiple === null ? undefined : { minimumTargetCostMultiple: variant.minimumTargetCostMultiple } satisfies ResearchEntryScreen,
  })) };
}

type Metrics = { netReturnUsdt: number; realizedPnlUsdt: number; profitFactor: number | null; closedTrades: number; expectancyUsdt: number | null;
  maxDrawdownUsdt: number; recoveryFactor: number | null; top3TradesProfitSharePercent: number | null; realizedPnlWithoutTop3Usdt: number;
  blocks: Array<{ netReturnUsdt: number; closedTrades: number; profitFactor: number | null }> };
export type CostExperimentRow = Metrics & { variant: string; size: number; scenario: string };
/** All runs are required. Lower loss or zero trades never constitutes positive evidence. */
export function screenCostExperiments(rows: CostExperimentRow[], scenarioNames: string[]) {
  const expected = COST_EXPERIMENT_VARIANTS.flatMap(v => [10, 30].flatMap(size => scenarioNames.map(s => `${v.name}:${size}:${s}`)));
  const keys = rows.map(r => `${r.variant}:${r.size}:${r.scenario}`);
  if (scenarioNames.length !== 2 || new Set(scenarioNames).size !== 2 || keys.length !== 20 || new Set(keys).size !== 20 || expected.some(key => !keys.includes(key))) throw new Error("Incomplete cost experiment matrix");
  const candidates = COST_EXPERIMENT_VARIANTS.map(v => {
    const runs = rows.filter(r => r.variant === v.name);
    const reasons = runs.flatMap(r => {
      const key = `${r.size}:${r.scenario}`;
      if (![r.netReturnUsdt, r.realizedPnlUsdt, r.maxDrawdownUsdt, r.realizedPnlWithoutTop3Usdt].every(Number.isFinite) || !Number.isInteger(r.closedTrades) || r.closedTrades < 0 || r.blocks.length !== 2 || r.blocks.some(b => !Number.isFinite(b.netReturnUsdt) || !Number.isInteger(b.closedTrades) || b.closedTrades < 0)) throw new Error("Invalid experiment metrics");
      return [
        ...(r.netReturnUsdt <= 0 || r.realizedPnlUsdt <= 0 ? [`${key}:nonpositive_result`] : []),
        ...(r.closedTrades < 30 ? [`${key}:small_sample`] : []),
        ...(r.profitFactor === null || !Number.isFinite(r.profitFactor) || r.profitFactor <= 1 ? [`${key}:no_positive_closed_trade_edge`] : []),
        ...(r.expectancyUsdt === null || !Number.isFinite(r.expectancyUsdt) || r.expectancyUsdt <= 0 ? [`${key}:nonpositive_expectancy`] : []),
        ...(r.blocks.some(b => b.netReturnUsdt <= 0 || b.closedTrades < 15) ? [`${key}:weak_development_block`] : []),
        ...(r.realizedPnlWithoutTop3Usdt <= 0 ? [`${key}:dependent_on_top_three`] : []),
      ];
    });
    return { variant: v.name, passesDevelopmentScreen: reasons.length === 0, reasons };
  });
  const costFamilyStable = candidates.filter(c => c.variant.startsWith("cost-buffer-")).every(c => c.passesDevelopmentScreen);
  return { status: candidates.some(c => c.passesDevelopmentScreen) ? "independent_protocol_required" : "blocked_no_eligible_candidate",
    candidates, costFamilyStable, holdoutExecuted: false, configurationPromoted: false, realMoneyApproved: false,
    note: "Descriptive development screen only. A single RSI threshold does not establish local parameter stability; no automatic winner or independent validation is produced." };
}

export function runCostExperiments(datasets: UniverseDataset[], rawReference: unknown, rawPlan: unknown) {
  const prepared = costExperimentStudies(rawReference, rawPlan);
  const rows: CostExperimentRow[] = [];
  const reports = prepared.variants.map(v => {
    // Entries use standard-scenario cost estimates for ALL scenarios, so stress does not change the entry rule.
    const report = compareUniverseSizes(datasets, v.study, "trend", v.screen);
    for (const universe of report.results) for (const s of universe.scenarios) {
      const r = s.result;
      rows.push({ variant: v.name, size: universe.size, scenario: s.scenario.name, netReturnUsdt: r.netReturnUsdt, realizedPnlUsdt: r.realizedPnlUsdt,
        profitFactor: r.profitFactor, closedTrades: r.closedTrades, expectancyUsdt: r.expectancyUsdt, maxDrawdownUsdt: r.maxDrawdownUsdt,
        recoveryFactor: r.recoveryFactor, top3TradesProfitSharePercent: r.top3TradesProfitSharePercent, realizedPnlWithoutTop3Usdt: r.realizedPnlWithoutTop3Usdt,
        blocks: r.blocks!.map(b => ({ netReturnUsdt: b.netReturnUsdt, closedTrades: b.closedTrades, profitFactor: b.profitFactor })) });
    }
    return { variant: v.name, studySha256: semanticHash(v.study), screen: v.screen ?? null, report };
  });
  return { prepared, reports, rows, readiness: screenCostExperiments(rows, prepared.reference.scenarios.map(s => s.name)) };
}
