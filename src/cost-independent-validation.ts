import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { costExperimentPlanSchema, screenCostExperiments, semanticHash } from "./cost-experiments.js";
import { comparisonSchema } from "./strategy-comparison.js";
import { universeStudySchema } from "./universe-comparison.js";
import { REGIME_CANDLE_MS } from "./btc-regime.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const count = z.number().int().nonnegative();
const amount = z.number().finite();
const block = z.object({ netReturnUsdt: amount, closedTrades: count, profitFactor: amount.nonnegative().nullable() }).strict();
const metrics = z.object({ netReturnUsdt: amount, profitFactor: amount.nonnegative().nullable(), closedTrades: count,
  maxDrawdownUsdt: amount.nonnegative(), blocks: z.array(block).length(2) });
const costRow = metrics.extend({ variant: z.string().max(80), size: z.union([z.literal(10), z.literal(30)]),
  scenario: z.enum(["account-conditioned", "account-cost-stress"]), realizedPnlUsdt: amount,
  expectancyUsdt: amount.nullable(), recoveryFactor: amount.nullable(),
  top3TradesProfitSharePercent: amount.min(0).max(100).nullable(), realizedPnlWithoutTop3Usdt: amount,
}).strict();
const identities = z.array(z.object({ symbol: z.string().regex(/^[A-Z0-9._-]+\/USDT$/), sha256: digest }).strict()).min(2).max(1000);
const coverage = z.object({ symbols: count, feeEvidenced: count, feesAssumed: count, measuredBuyQuoteSymbols: count });
const evidenceSchema = z.object({
  status: z.literal("cost_aware_development_experiments_only"), protocol: costExperimentPlanSchema, protocolSha256: digest,
  referenceStudySha256: digest, sourceStudySha256: digest, datasetHashes: identities,
  referenceConfigurationHash: digest, referenceSourceCommit: commit.nullable(), feeEvidenceCoverage: coverage,
  results: z.array(costRow).length(20),
});
const financialSchema = z.object({ status: z.literal("financial_reference_only"), studySha256: digest, sourceStudySha256: digest,
  configurationHash: digest, sourceCommit: commit.nullable(), datasetHashes: identities, coverage,
  reference: z.object({ budgetUsdt: amount.positive(), lotUsdt: amount.positive(),
    portfolio: z.object({ maxConcurrentPositions: count, maxExposureRate: amount, maxAltExposureRate: amount }), parameters: comparisonSchema.shape.baseline }),
  scenarios: z.array(z.object({ size: z.union([z.literal(10), z.literal(30)]), results: z.array(metrics.extend({ scenario: z.enum(["account-conditioned", "account-cost-stress"]) })).length(2) })).length(2),
});
const sameNumber = (a: number, b: number) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
const sortedIdentities = (data: z.infer<typeof identities>) => [...data].sort((a, b) => a.symbol.localeCompare(b.symbol, "en"));

/** Recomputes readiness from numerical evidence, never from editable claimed readiness flags. */
export function assessCostIndependentReadiness(rawEvidence: unknown, rawFinancial: unknown, rawSource: unknown) {
  const evidence = evidenceSchema.parse(rawEvidence), financial = financialSchema.parse(rawFinancial), source = universeStudySchema.parse(rawSource);
  if (semanticHash(evidence.protocol) !== evidence.protocolSha256 || evidence.referenceStudySha256 !== evidence.protocol.referenceStudySha256 || evidence.sourceStudySha256 !== evidence.protocol.sourceStudySha256 || evidence.sourceStudySha256 !== semanticHash(source) || financial.studySha256 !== evidence.referenceStudySha256 || financial.sourceStudySha256 !== evidence.sourceStudySha256) throw new Error("Independent readiness source/protocol hash mismatch");
  const unique = new Set(evidence.datasetHashes.map(d => d.symbol));
  if (unique.size !== evidence.datasetHashes.length || !isDeepStrictEqual(sortedIdentities(evidence.datasetHashes), sortedIdentities(financial.datasetHashes))) throw new Error("Independent readiness dataset identity mismatch");
  if (financial.configurationHash !== evidence.referenceConfigurationHash || financial.sourceCommit !== evidence.referenceSourceCommit || !isDeepStrictEqual(financial.coverage, evidence.feeEvidenceCoverage) || evidence.feeEvidenceCoverage.symbols !== unique.size || evidence.feeEvidenceCoverage.feeEvidenced + evidence.feeEvidenceCoverage.feesAssumed !== unique.size || evidence.feeEvidenceCoverage.measuredBuyQuoteSymbols > unique.size) throw new Error("Independent readiness configuration/coverage mismatch");
  const financialKeys = financial.scenarios.flatMap(u => u.results.map(r => `${u.size}:${r.scenario}`));
  if (new Set(financialKeys).size !== 4) throw new Error("Incomplete financial baseline matrix");
  for (const r of evidence.results) {
    if (!sameNumber(r.blocks.reduce((sum, b) => sum + b.netReturnUsdt, 0), r.netReturnUsdt) || r.blocks.reduce((sum, b) => sum + b.closedTrades, 0) !== r.closedTrades ||
      (r.closedTrades === 0 ? r.expectancyUsdt !== null || r.realizedPnlUsdt !== 0 : r.expectancyUsdt === null || !sameNumber(r.expectancyUsdt * r.closedTrades, r.realizedPnlUsdt)) ||
      (r.maxDrawdownUsdt === 0 ? r.recoveryFactor !== null : r.recoveryFactor === null || !sameNumber(r.netReturnUsdt / r.maxDrawdownUsdt, r.recoveryFactor)) ||
      r.realizedPnlWithoutTop3Usdt > r.realizedPnlUsdt + 1e-8) throw new Error("Inconsistent development metrics");
    if (r.variant === "reference") {
      const original = financial.scenarios.find(u => u.size === r.size)?.results.find(s => s.scenario === r.scenario);
      const project = (value: z.infer<typeof metrics>) => ({ netReturnUsdt: value.netReturnUsdt, profitFactor: value.profitFactor, closedTrades: value.closedTrades, maxDrawdownUsdt: value.maxDrawdownUsdt, blocks: value.blocks });
      if (!original || !isDeepStrictEqual(project(r), project(original))) throw new Error("Financial baseline results differ");
    }
  }
  const screen = screenCostExperiments(evidence.results, ["account-conditioned", "account-cost-stress"]);
  const sourceEnd = Date.parse(source.endExclusiveUtc), sourceStart = sourceEnd - (source.days * 96 + source.warmupCandles) * REGIME_CANDLE_MS;
  const candidates = screen.candidates.map(c => ({ ...c,
    readyToFreeze: c.passesDevelopmentScreen && (c.variant === "reference" || c.variant.startsWith("cost-buffer-") && screen.costFamilyStable),
    freezeBlockers: c.passesDevelopmentScreen ? (c.variant === "rsi-63" ? ["single_rsi_threshold_stability_not_verified"] : c.variant.startsWith("cost-buffer-") && !screen.costFamilyStable ? ["neighboring_cost_thresholds_not_stable"] : []) : ["development_screen_failed"],
  }));
  return { schemaVersion: 1, status: candidates.some(c => c.readyToFreeze) ? "frozen_protocol_required" : "blocked_no_eligible_candidate",
    evidenceHash: semanticHash(rawEvidence), financialReferenceHash: semanticHash(rawFinancial), protocolSha256: evidence.protocolSha256,
    referenceStudySha256: evidence.referenceStudySha256, sourceStudySha256: evidence.sourceStudySha256,
    sourceConfigurationHash: evidence.referenceConfigurationHash, sourceCommit: evidence.referenceSourceCommit,
    datasetIdentityHash: semanticHash(sortedIdentities(evidence.datasetHashes)), feeEvidenceCoverage: evidence.feeEvidenceCoverage,
    consultedDevelopmentWindow: { startUtc: new Date(sourceStart).toISOString(), endExclusiveUtc: new Date(sourceEnd).toISOString(), includesWarmup: true },
    candidates, costFamilyStable: screen.costFamilyStable, minimumWarmupCandles: Math.max(source.warmupCandles, source.candleLimit - 1),
    reference: financial.reference, definitions: evidence.protocol.variants,
    holdoutExecuted: false, configurationPromoted: false, realMoneyApproved: false,
    nextAction: candidates.some(c => c.readyToFreeze) ? "Freeze code, candidate, costs, data policy, dates and inspection registry before collecting independent data." : "Reconsider the entry hypothesis in development; do not certify the least negative variant or consume a new holdout for it.",
    limitations: [
      "Hashes and consistency checks do not authenticate exported evidence or establish that no other data was inspected.",
      "This recomputes the descriptive screen for every candidate, universe and cost scenario. Thirty closes are not statistical proof; partial fee evidence and simulator limitations remain.",
      "An eligible cost variant also requires its two neighboring thresholds to pass. The single alternative RSI threshold has no local stability evidence.",
      "No new data is read, collected or replayed. Independent-window selection and its warmup must exclude every consulted window, not only this development source.",
      "A prospective Demo window checks execution, not financial advantage. No trading, deployment or real-money approval is performed.",
    ],
  };
}

const windowSchema = z.object({ startUtc: z.iso.datetime(), endExclusiveUtc: z.iso.datetime() }).strict();
const freezeSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal("independent_offline_protocol"), codeCommit: commit,
  candidate: z.enum(["reference", "rsi-63", "cost-buffer-1.5", "cost-buffer-2", "cost-buffer-2.5"]),
  evidenceHash: digest, financialReferenceHash: digest,
  evaluationStartUtc: z.iso.datetime(), evaluationEndExclusiveUtc: z.iso.datetime(), warmupCandles: z.number().int().min(84).max(2000),
  otherInspectedWindows: z.array(windowSchema).max(100),
  inspectionRegistryDeclaredComplete: z.literal(true), independentDataDeclaredUninspected: z.literal(true),
  acceptance: z.object({ positiveMarkedAndRealizedResultEachBlock: z.literal(true), minimumClosedTradesPerBlock: z.literal(30), minimumProfitFactorEachBlock: z.literal(1.25), costsAndRiskUnchanged: z.literal(true) }).strict(),
}).strict();

/** Optional protocol preparation only. Never reads market data or approves an order. */
export function prepareCostIndependentFreeze(rawFreeze: unknown, evidence: unknown, financial: unknown, source: unknown) {
  const readiness = assessCostIndependentReadiness(evidence, financial, source);
  if (readiness.status !== "frozen_protocol_required") throw new Error("No eligible development candidate: independent freeze blocked");
  const freeze = freezeSchema.parse(rawFreeze);
  if (freeze.evidenceHash !== readiness.evidenceHash || freeze.financialReferenceHash !== readiness.financialReferenceHash) throw new Error("Freeze evidence hash mismatch");
  if (!readiness.candidates.some(c => c.variant === freeze.candidate && c.readyToFreeze)) throw new Error("Candidate not eligible for freeze");
  const start = Date.parse(freeze.evaluationStartUtc), end = Date.parse(freeze.evaluationEndExclusiveUtc);
  const warmupStart = start - freeze.warmupCandles * REGIME_CANDLE_MS;
  if (start % REGIME_CANDLE_MS || end % REGIME_CANDLE_MS || end - start !== 20 * 96 * REGIME_CANDLE_MS || freeze.warmupCandles < readiness.minimumWarmupCandles) throw new Error("Independent window requires 20 aligned days and sufficient warmup");
  const windows = [readiness.consultedDevelopmentWindow, ...freeze.otherInspectedWindows];
  for (const w of windows) {
    const from = Date.parse(w.startUtc), to = Date.parse(w.endExclusiveUtc);
    if (from >= to || from % REGIME_CANDLE_MS || to % REGIME_CANDLE_MS) throw new Error("Invalid inspected window");
    if (warmupStart < to && end > from) throw new Error("Independent window or warmup overlaps consulted data");
  }
  const frozen = { ...freeze, reference: readiness.reference, candidateDefinition: readiness.definitions.find(d => d.name === freeze.candidate)!,
    datasetIdentityHash: readiness.datasetIdentityHash, costProtocolSha256: readiness.protocolSha256,
    referenceStudySha256: readiness.referenceStudySha256, sourceStudySha256: readiness.sourceStudySha256, sourceConfigurationHash: readiness.sourceConfigurationHash,
    dataSource: "okx-public-spot", timeframe: "15m", executionMode: "offline-only", universePolicy: "same-frozen-source-pool-with-coverage-limitations",
    universes: [10, 30], scenarios: ["account-conditioned", "account-cost-stress"], blockDays: 10,
    warmupStartUtc: new Date(warmupStart).toISOString(), developmentWindow: readiness.consultedDevelopmentWindow,
    independenceStatus: "declared_not_independently_verified" };
  return { status: "frozen_protocol_only", freezeHash: semanticHash(frozen), frozen,
    holdoutExecuted: false, configurationPromoted: false, realMoneyApproved: false,
    limitations: ["This file records a declared protocol, not verified independent data or a completed test. Code identity and inspection-registry completeness remain to be verified before any future collection.", "Do not change parameters after reading evaluation results; a failed test requires a new hypothesis and genuinely new evaluation data."] };
}
