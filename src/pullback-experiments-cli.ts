import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { semanticHash } from "./cost-experiments.js";
import { pullbackPlanSchema, runPullbackExperiments } from "./pullback-experiments.js";
import { datasetHash, type UniverseDataset } from "./universe-comparison.js";

const [planPath, dataDirectory, referenceDirectory, outputDirectory, ...extra] = process.argv.slice(2);
if (!planPath || !dataDirectory || !referenceDirectory || !outputDirectory || extra.length) throw new Error("Usage: strategy:pullback -- <plan.json> <frozen-data-directory> <financial-reference-directory> <new-output-directory>");
if ([dataDirectory, referenceDirectory].some(dir => resolve(dir) === resolve(outputDirectory))) throw new Error("Output must not replace frozen inputs");
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const plan = pullbackPlanSchema.parse(await json(planPath));
const source = await json(join(dataDirectory, "source.json"));
const reference = await json(join(referenceDirectory, "study.json"));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const archived = z.object({
  sourceStudySha256: digest, studySha256: digest,
  configurationHash: digest.nullable().optional(), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/).nullable().optional(),
  datasetHashes: z.array(z.object({ symbol: z.string().regex(/^[A-Z0-9._-]+\/USDT$/), sha256: digest }).strict()),
  coverage: z.object({ symbols: z.number().int().nonnegative(), feeEvidenced: z.number().int().nonnegative(), feesAssumed: z.number().int().nonnegative(), measuredBuyQuoteSymbols: z.number().int().nonnegative().optional() }),
  scenarios: z.array(z.object({ size: z.number().int(), results: z.array(z.object({ scenario: z.string(), netReturnUsdt: z.number().finite(), profitFactor: z.number().finite().nullable(), closedTrades: z.number().int().nonnegative(), maxDrawdownUsdt: z.number().finite().nonnegative() })) })),
}).parse(await json(join(referenceDirectory, "summary.json")));
if (!source.complete || !Array.isArray(source.assets) || source.studySha256 !== plan.sourceStudySha256 || archived.sourceStudySha256 !== source.studySha256 || archived.studySha256 !== plan.referenceStudySha256 || semanticHash(reference) !== archived.studySha256) throw new Error("Frozen reference/source identity mismatch");
const datasets: UniverseDataset[] = await Promise.all(source.assets.map(async (entry: { symbol: string; filename: string; sha256: string }) => {
  if (!/^[A-Z0-9._-]+-USDT\.json$/.test(entry.filename) || entry.filename !== entry.symbol.replace("/", "-") + ".json") throw new Error("Invalid frozen source filename");
  const data = await json(join(dataDirectory, entry.filename));
  if (data.symbol !== entry.symbol || datasetHash(data) !== entry.sha256) throw new Error("Frozen dataset hash mismatch");
  return data;
}));
const identities = datasets.map(d => ({ symbol: d.symbol, sha256: datasetHash(d) }));
const key = (rows: typeof identities) => semanticHash([...rows].sort((a, b) => a.symbol.localeCompare(b.symbol, "en")));
if (!Array.isArray(archived.datasetHashes) || key(identities) !== key(archived.datasetHashes)) throw new Error("Reference dataset identities mismatch");
const experiment = runPullbackExperiments(datasets, reference, plan);
for (const row of experiment.rows.filter(r => r.variant === "reference")) {
  const matches = archived.scenarios.filter(u => u.size === row.size).flatMap(u => u.results.filter(s => s.scenario === row.scenario));
  const prior = matches[0];
  if (matches.length !== 1 || !prior || prior.netReturnUsdt !== row.netReturnUsdt || prior.profitFactor !== row.profitFactor || prior.closedTrades !== row.closedTrades || prior.maxDrawdownUsdt !== row.maxDrawdownUsdt) throw new Error("Reference replay differs from archived financial baseline");
}
// Keep the complete ledger outside Git; publish a compact, allowlisted summary with all attempts.
const summary = {
  status: "pullback_development_experiments_only", protocol: plan, protocolSha256: semanticHash(plan),
  referenceStudySha256: plan.referenceStudySha256, sourceStudySha256: plan.sourceStudySha256, datasetHashes: identities,
  referenceConfigurationHash: archived.configurationHash, referenceSourceCommit: archived.sourceCommit, feeEvidenceCoverage: archived.coverage,
  results: experiment.rows, readiness: experiment.readiness,
  comparisons: experiment.comparisons,
  referenceStudy: experiment.reference,
  limitations: [
    "Four alternatives fixed before replay on previously inspected development data; no new holdout, threshold optimization, automatic promotion or live mutation.",
    "Capital, ceiling, exits, fees, spread/slippage, portfolio limits, seeds, membership and dates are common; actual exposure and turnover can change.",
    "Confirmation requires prior extended trend, declining close touching EMA21+0.25 ATR, subsequent bullish recovery above prior high and EMA21 within four candles, without breaking setup low. One attempt per setup, even if other gates reject it. Rearm requires a fresh extension above 0.8 ATR.",
    "Recovery close must lie 0..0.8 ATR above EMA21; RSI58 is an additional gate. RSI rejection consumes the same attempt. Entry remains next open; no intrabar fill at EMA is assumed.",
    "Fees are partially evidenced; historical books, slippage, historical eligibility and full live scheduling/risk guards remain approximations. Development results do not establish real-money profitability.",
    "Improved PF and expectancy versus a losing reference do not constitute positive edge; small samples, weak blocks and top-three dependence block promotion.",
  ],
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
for (const r of experiment.reports) await writeFile(join(outputDirectory, r.variant + ".json"), JSON.stringify(r, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
