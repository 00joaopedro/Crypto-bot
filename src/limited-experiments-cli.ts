import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { universeStudySchema, compareUniverseSizes, datasetHash, type UniverseDataset } from "./universe-comparison.js";
const [manifest, directory] = process.argv.slice(2);
if (!manifest || !directory) throw new Error("Usage: strategy:experiments -- <original-study.json> <frozen-dataset-directory>");
const study = universeStudySchema.parse(JSON.parse(await readFile(manifest, "utf8")));
const source = JSON.parse(await readFile(join(directory, "source.json"), "utf8"));
if (!source.complete || source.studySha256 !== createHash("sha256").update(JSON.stringify(study)).digest("hex")) throw new Error("Frozen source does not match original manifest");
const datasets: UniverseDataset[] = await Promise.all(source.assets.map(async (entry: { symbol: string; filename: string; sha256: string }) => {
  if (!/^[A-Z0-9._-]+-USDT\.json$/.test(entry.filename) || entry.filename !== entry.symbol.replace("/", "-") + ".json") throw new Error("Invalid source filename");
  const dataset = JSON.parse(await readFile(join(directory, entry.filename), "utf8"));
  if (dataset.symbol !== entry.symbol || datasetHash(dataset) !== entry.sha256) throw new Error("Dataset hash mismatch");
  return dataset;
}));
if (!study.parameters.exitPolicy || study.parameters.exitPolicy.mode !== "fixed" || study.parameters.executionDelayCandles !== 1) throw new Error("Experiment reference requires fixed managed exits and one-candle execution delay");
const variants = [
  { name: "reference", parameters: study.parameters },
  { name: "delay-two-candles", parameters: { ...study.parameters, executionDelayCandles: 2 } },
  { name: "managed-atr-trailing", parameters: { ...study.parameters, exitPolicy: { ...study.parameters.exitPolicy, mode: "trailing_atr" as const } } },
];
// No parameter search, automatic winner, order or runtime configuration update.
console.log(JSON.stringify({ status: "exploratory_experiments_only", protocol: "Each alternative changes one factor. Delay is not a pullback strategy. Reused data is not independent validation.",
  results: variants.map(v => ({ name: v.name, report: compareUniverseSizes(datasets, { ...study, sizes: [10, 30], parameters: v.parameters }) })) }));
