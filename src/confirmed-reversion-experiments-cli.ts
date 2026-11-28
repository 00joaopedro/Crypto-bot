import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { semanticHash } from "./cost-experiments.js";
import { confirmedReversionPlanSchema, runConfirmedReversionExperiments } from "./confirmed-reversion-experiments.js";
import { datasetHash, type UniverseDataset } from "./universe-comparison.js";

const [planPath, dataDirectory, referenceDirectory, outputDirectory, ...extra] = process.argv.slice(2);
if (!planPath || !dataDirectory || !referenceDirectory || !outputDirectory || extra.length) throw new Error("Usage: strategy:confirmed-reversion -- <plan.json> <frozen-data-directory> <financial-reference-directory> <new-output-directory>");
if ([dataDirectory, referenceDirectory].some(dir => resolve(dir) === resolve(outputDirectory))) throw new Error("Output must not replace frozen inputs");
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const plan = confirmedReversionPlanSchema.parse(await json(planPath));
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
const experiment = runConfirmedReversionExperiments(datasets, reference, plan);
for (const row of experiment.rows.filter(r => r.variant === "reference")) {
  const matches = archived.scenarios.filter(u => u.size === row.size).flatMap(u => u.results.filter(s => s.scenario === row.scenario));
  const prior = matches[0];
  if (matches.length !== 1 || !prior || prior.netReturnUsdt !== row.netReturnUsdt || prior.profitFactor !== row.profitFactor || prior.closedTrades !== row.closedTrades || prior.maxDrawdownUsdt !== row.maxDrawdownUsdt) throw new Error("Reference replay differs from archived financial baseline");
}
// Keep the complete ledger outside Git; publish a compact, allowlisted summary with all attempts.
const summary = {
  status: "confirmed_reversion_development_experiments_only", protocol: plan, protocolSha256: semanticHash(plan),
  referenceStudySha256: plan.referenceStudySha256, sourceStudySha256: plan.sourceStudySha256, datasetHashes: identities,
  referenceConfigurationHash: archived.configurationHash, referenceSourceCommit: archived.sourceCommit, feeEvidenceCoverage: archived.coverage,
  results: experiment.rows, readiness: experiment.readiness,
  diagnostics: experiment.diagnostics,
  variants: experiment.reports.map(r=>({variant:r.variant,entryModel:r.entryModel,signalDiagnostics:r.signalDiagnostics,costChecks:r.costChecks})),
  referenceStudy: experiment.reference,
  limitations: [
    "One new predeclared mean-reversion candidate and the archived trend reference; eight size/scenario comparisons on already inspected development data. The legacy mean-reversion study remains unchanged.",
    "Bollinger20/2 uses population deviation. Setup requires a new close below its lower band with RSI7<25. First later green close back inside and above previous close within four bars consumes the attempt; RSI7 must still be <25 and price cannot be below a falling EMA50 (four-bar slope). No same-bar confirmation or setup renewal while outside.",
    "Target is SMA20 at the closed recovery decision and is frozen. Initial ATR14 stop follows the reference stop multiplier, floor and cap at next-open entry. No trailing, opposite-signal exit, retrospectively moving target or forced exit at the end of data.",
    "Decision cost screen uses standard per-pair costs. Next-open admission rechecks the fixed target using the scenario's costs and open proxy; gaps can reject entry. A positive target margin is necessary, not an expected-profit estimate. Out-of-range target rates are rejected instead of widening execution limits.",
    "Same capital, ceiling, costs, seeds, quality/tradability, universe ranking, exposure, liquidity and cooldown constraints; new entry/target rules naturally change exposure and turnover. No inherited trend-BUY requirement is imposed on a different strategy.",
    "Historical books, eligibility, precision/dust, fills and complete live scheduling/risk remain approximations. Stop wins simultaneous touches; downside gaps use the worse open. Fee evidence is partial, and marked remaining positions are not executable liquidation quotes.",
    "Signal counts describe the full pool before membership and portfolio admission. Legacy RSI14 entry context is descriptive; the new signal uses RSI7 as frozen in its protocol.",
    "All negative outcomes and small samples remain; no new holdout, parameter retuning after results, runtime setting, order, deployment, promotion or real-money approval.",
  ],
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
for (const r of experiment.reports) await writeFile(join(outputDirectory, r.variant + ".json"), JSON.stringify(r, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
