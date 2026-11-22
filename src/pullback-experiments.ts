import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { semanticHash, type CostExperimentRow } from "./cost-experiments.js";
import { PULLBACK_RULES, type PullbackRule } from "./research-pullback.js";
import { compareUniverseSizes, universeStudySchema, type UniverseDataset } from "./universe-comparison.js";
export const PULLBACK_VARIANTS = ["reference", "near-ema21", "confirmed-pullback", "confirmed-pullback-rsi58"] as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const pullbackPlanSchema = z.object({ protocol: z.literal("pullback-development-v1"), referenceStudySha256: digest, sourceStudySha256: digest,
  sizes: z.tuple([z.literal(10), z.literal(30)]), variants: z.array(z.string()).length(4),
  rules: z.object({ maximumExtensionAtr: z.literal(0.8), touchDistanceAtr: z.literal(0.25), expiryCandles: z.literal(4), maximumRsi: z.literal(58) }).strict(),
  minimumClosedTradesPerRun: z.literal(30),
}).strict().refine(p => isDeepStrictEqual(p.variants, PULLBACK_VARIANTS) && isDeepStrictEqual(p.rules, PULLBACK_RULES), "Only predeclared pullback alternatives are allowed");
export function screenPullbackExperiments(rows: CostExperimentRow[], scenarios: string[]) {
  const expected = PULLBACK_VARIANTS.flatMap(v => [10,30].flatMap(size => scenarios.map(s => `${v}:${size}:${s}`)));
  const keys = rows.map(r => `${r.variant}:${r.size}:${r.scenario}`);
  if (scenarios.length !== 2 || new Set(scenarios).size !== 2 || keys.length !== 16 || new Set(keys).size !== 16 || expected.some(k => !keys.includes(k))) throw new Error("Incomplete pullback matrix");
  const candidates = PULLBACK_VARIANTS.map(variant => {
    const runs = rows.filter(r => r.variant === variant);
    const reasons = runs.flatMap(r => {
      if (![r.netReturnUsdt,r.realizedPnlUsdt,r.maxDrawdownUsdt,r.realizedPnlWithoutTop3Usdt].every(Number.isFinite) || !Number.isInteger(r.closedTrades) || r.closedTrades < 0 || r.blocks.length !== 2 || r.blocks.some(b => !Number.isFinite(b.netReturnUsdt) || !Number.isInteger(b.closedTrades) || b.closedTrades < 0)) throw new Error("Invalid pullback metrics");
      const k = `${r.size}:${r.scenario}`;
      return [
        ...(r.netReturnUsdt <= 0 || r.realizedPnlUsdt <= 0 ? [`${k}:nonpositive_result`] : []),
        ...(r.closedTrades < 30 ? [`${k}:small_sample`] : []),
        ...(r.profitFactor === null || !Number.isFinite(r.profitFactor) || r.profitFactor <= 1 ? [`${k}:no_positive_closed_trade_edge`] : []),
        ...(r.expectancyUsdt === null || !Number.isFinite(r.expectancyUsdt) || r.expectancyUsdt <= 0 ? [`${k}:nonpositive_expectancy`] : []),
        ...(r.blocks.some(b => b.netReturnUsdt <= 0 || b.closedTrades < 15) ? [`${k}:weak_development_block`] : []),
        ...(r.realizedPnlWithoutTop3Usdt <= 0 ? [`${k}:dependent_on_top_three`] : []),
      ];
    });
    return { variant, passesDevelopmentScreen: reasons.length === 0, reasons };
  });
  return { status: candidates.some(c => c.passesDevelopmentScreen) ? "independent_protocol_required" : "blocked_no_eligible_candidate", candidates,
    holdoutExecuted: false, configurationPromoted: false, realMoneyApproved: false };
}
export function runPullbackExperiments(datasets: UniverseDataset[], rawReference: unknown, rawPlan: unknown) {
  const plan = pullbackPlanSchema.parse(rawPlan), reference = universeStudySchema.parse(rawReference);
  if (semanticHash(reference) !== plan.referenceStudySha256) throw new Error("Financial reference hash mismatch");
  if (!isDeepStrictEqual(reference.sizes,plan.sizes) || reference.parameters.maxBuyRsi !== 70 || reference.parameters.executionDelayCandles !== 1 || reference.parameters.exitPolicy?.mode !== "fixed" || reference.parameters.exitPolicy.breakeven || reference.scenarios.length !== 2 || reference.scenarios.some(s => !s.symbolCosts)) throw new Error("Frozen fixed-exit financial reference required");
  const rows: CostExperimentRow[] = [];
  const reports = PULLBACK_VARIANTS.map(variant => {
    const rule = variant === "reference" ? undefined : variant satisfies PullbackRule;
    const report = compareUniverseSizes(datasets, reference, "trend", undefined, rule);
    for (const u of report.results) for (const s of u.scenarios) {
      const r = s.result;
      rows.push({ variant, size: u.size, scenario: s.scenario.name, netReturnUsdt:r.netReturnUsdt, realizedPnlUsdt:r.realizedPnlUsdt, profitFactor:r.profitFactor,closedTrades:r.closedTrades,expectancyUsdt:r.expectancyUsdt,maxDrawdownUsdt:r.maxDrawdownUsdt,recoveryFactor:r.recoveryFactor,top3TradesProfitSharePercent:r.top3TradesProfitSharePercent,realizedPnlWithoutTop3Usdt:r.realizedPnlWithoutTop3Usdt,blocks:r.blocks!.map(b=>({netReturnUsdt:b.netReturnUsdt,closedTrades:b.closedTrades,profitFactor:b.profitFactor})) });
    }
    return { variant, report };
  });
  const comparisons = rows.filter(r=>r.variant!=="reference").map(r=>{
    const b=rows.find(b=>b.variant==="reference"&&b.size===r.size&&b.scenario===r.scenario)!;
    return { variant:r.variant,size:r.size,scenario:r.scenario,closedTradesDelta:r.closedTrades-b.closedTrades,netPnlDeltaUsdt:r.netReturnUsdt-b.netReturnUsdt,
      profitFactorDelta:r.profitFactor===null||b.profitFactor===null?null:r.profitFactor-b.profitFactor,
      expectancyDeltaUsdt:r.expectancyUsdt===null||b.expectancyUsdt===null?null:r.expectancyUsdt-b.expectancyUsdt,
      improvesBothPerTradeMetrics:r.profitFactor!==null&&b.profitFactor!==null&&r.profitFactor>b.profitFactor&&r.expectancyUsdt!==null&&b.expectancyUsdt!==null&&r.expectancyUsdt>b.expectancyUsdt };
  });
  return { plan, reference, rows, reports, comparisons, readiness:screenPullbackExperiments(rows,reference.scenarios.map(s=>s.name)) };
}
