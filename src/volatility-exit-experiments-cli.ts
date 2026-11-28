import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { semanticHash } from "./cost-experiments.js";
import { volatilityExitPlanSchema, runVolatilityExitExperiments } from "./volatility-exit-experiments.js";
import { datasetHash, type UniverseDataset } from "./universe-comparison.js";

const [planPath, dataDirectory, referenceDirectory, outputDirectory, ...extra] = process.argv.slice(2);
if (!planPath || !dataDirectory || !referenceDirectory || !outputDirectory || extra.length) throw new Error("Usage: strategy:volatility-exits -- <plan.json> <frozen-data-directory> <financial-reference-directory> <new-output-directory>");
if ([dataDirectory, referenceDirectory].some(dir => resolve(dir) === resolve(outputDirectory))) throw new Error("Output must not replace frozen inputs");
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const plan = volatilityExitPlanSchema.parse(await json(planPath));
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
const experiment = runVolatilityExitExperiments(datasets, reference, plan);
for (const row of experiment.rows.filter(r => r.variant === "reference")) {
  const matches = archived.scenarios.filter(u => u.size === row.size).flatMap(u => u.results.filter(s => s.scenario === row.scenario));
  const prior = matches[0];
  if (matches.length !== 1 || !prior || prior.netReturnUsdt !== row.netReturnUsdt || prior.profitFactor !== row.profitFactor || prior.closedTrades !== row.closedTrades || prior.maxDrawdownUsdt !== row.maxDrawdownUsdt) throw new Error("Reference replay differs from archived financial baseline");
}
// Keep the complete ledger outside Git; publish a compact, allowlisted summary with all attempts.
const summary = {
  status: "volatility_exit_development_experiments_only", protocol: plan, protocolSha256: semanticHash(plan),
  referenceStudySha256: plan.referenceStudySha256, sourceStudySha256: plan.sourceStudySha256, datasetHashes: identities,
  referenceConfigurationHash: archived.configurationHash, referenceSourceCommit: archived.sourceCommit, feeEvidenceCoverage: archived.coverage,
  results: experiment.rows, readiness: experiment.readiness,
  comparisons: experiment.comparisons,
  exitDiagnostics: experiment.exitDiagnostics,
  variants: experiment.reports.map(r=>({variant:r.variant,studySha256:r.studySha256,research:r.research})),
  referenceStudy: experiment.reference,
  limitations: [
    "Four predeclared development variants on already inspected data: original fixed exit, ATR floor only, net trailing with target, net trailing replacing target. No pullback, RSI58 or combined ATR+trailing optimization.",
    "ATR14/close >=0.75% is evaluated on closed decision candles; stops, initial risk, fees, capital, seeds, limits and windows remain common. Changed exits can change subsequent entries and exposure.",
    "Net trailing activation requires a surviving candle close with modeled liquidation return >=1.2% after entry and exit fees and exit spread/slippage. Initial fill already includes entry spread/slippage, not charged twice. Activation latches and updates are usable only on later candles.",
    "Trailing distance is 1.5 ATR14, preserves initial protection and never loosens. The with-target variant preserves fixed take-profit; the no-target variant removes only that take-profit, without increasing position risk ceilings. Gaps can lose more than an ideal stop.",
    "Fixed-target geometry is descriptive on closed reference trades. Trailing counters report all openings, activation on surviving closes, stop updates and exits before/after activation; STOP_LOSS labels include ratcheted managed stops.",
    "Net activation is an estimated liquidation value, not realized profit, a guaranteed protected return, or proof of execution at historical highs. Intrabar order is unknown; stop wins simultaneous touches; no same-candle retroactive trailing stop.",
    "Historical books, liquidity, regional eligibility, scheduling, dust and full operational guards remain approximations. Fee evidence is partial and account conditioned. Open positions use common marks, not executable liquidation quotes.",
    "All attempts, negative blocks and small samples remain. No new holdout, parameter search after results, runtime setting, order, deployment, configuration promotion or real-money approval.",
  ],
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
for (const r of experiment.reports) await writeFile(join(outputDirectory, r.variant + ".json"), JSON.stringify(r, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
