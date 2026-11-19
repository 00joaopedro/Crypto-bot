import ccxt from "ccxt";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { createHash } from "node:crypto";
import { compareUniverseSizes, universeStudySchema, datasetHash, validateUniverseDatasets, type UniverseDataset, type UniverseStudy } from "./universe-comparison.js";
import { collectUniverseHistory } from "./universe-history.js";
import { marketEntryBlock } from "./market-eligibility.js";
import { REGIME_CANDLE_MS } from "./btc-regime.js";

const collect = process.argv[2] === "--collect";
const [manifest, directory] = process.argv.slice(collect ? 3 : 2);
if (!manifest || !directory) throw new Error("Usage: strategy:universe -- [--collect] <study.json> <directory>");
const study = universeStudySchema.parse(JSON.parse(await readFile(manifest, "utf8")));
const studySha256 = createHash("sha256").update(JSON.stringify(study)).digest("hex");
const end = Date.parse(study.endExclusiveUtc);
if (end > Date.now()) throw new Error("Historical evaluation end must already be completed");
await mkdir(directory, { recursive: true });
const sourcePath = join(directory, "source.json");
const existing = await readFile(sourcePath, "utf8").then(JSON.parse, () => undefined);
if (existing && existing.studySha256 !== studySha256) throw new Error("Output directory belongs to a different study");
if (collect && !existing?.complete) await collectSource(study);
else if (collect) console.log("Reusing frozen source snapshot; no new market selection");
else {
  if (!existing?.complete || !Array.isArray(existing.assets)) throw new Error("Collect and validate source data first");
  const datasets = await Promise.all(existing.assets.map(async (entry: { symbol: string; filename: string; sha256: string }) => {
    if (entry.filename !== `${entry.symbol.replace("/", "-")}.json` || !/^[A-Z0-9._-]+-USDT\.json$/.test(entry.filename)) throw new Error("Invalid source filename");
    const dataset: UniverseDataset = JSON.parse(await readFile(join(directory, entry.filename), "utf8"));
    if (dataset.symbol !== entry.symbol || datasetHash(dataset) !== entry.sha256) throw new Error(`Dataset hash mismatch: ${entry.symbol}`);
    return dataset;
  }));
  const report = { ...compareUniverseSizes(datasets, study), source: existing };
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
  const metricSummary = (r: typeof report.results[number]["scenarios"][number]["result"]) => {
    const { perSymbol, ...summary } = r;
    return { ...summary, ...(r.blocks ? { blocks: r.blocks.map(({ perSymbol: _assets, ...block }) => block) } : {}), rejected: perSymbol.reduce<Record<string, number>>((all, asset) => {
      for (const [reason, n] of Object.entries(asset.rejected)) all[reason] = (all[reason] ?? 0) + n;
      return all;
    }, {}) };
  };
  const summary = { status: report.status, studySha256, study: report.study, coverage: report.coverage, assets: report.assets,
    source: { capturedAtUtc: existing.capturedAtUtc, collected: existing.assets.length, skipped: existing.skipped.length, maximumSymbols: study.collection.maximumSymbols, selection: existing.selection },
    calibration: report.calibration.map(c => ({ size: c.size, result: metricSummary(c.result) })),
    selectedSizeFromCalibration: report.selectedSizeFromCalibration,
    results: report.results.map(r => ({ size: r.size, scenarios: r.scenarios.map(s => ({ scenario: s.scenario, bothBlocksPositive: s.bothBlocksPositive, result: metricSummary(s.result) })) })),
    durationMs: report.durationMs, recommendation: report.recommendation, limitations: report.limitations };
  await writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log("UNIVERSE_REPORT=" + JSON.stringify(summary));
}

async function collectSource(study: UniverseStudy) {
  const start = end - (study.days * 96 + study.warmupCandles) * REGIME_CANDLE_MS;
  const exchange = new ccxt.okx({ enableRateLimit: true, timeout: 15000 });
  const capturedAtUtc = new Date().toISOString();
  const assets: Array<{ symbol: string; filename: string; sha256: string }> = [];
  const skipped: Array<{ symbol: string; reason: string }> = [];
  const preference = new Map(study.collection.preferredSymbols.map((s, i) => [s, i]));
  let requests = 0;
  try {
    await exchange.loadMarkets();
    const markets = Object.values(exchange.markets ?? {}).filter(m => !marketEntryBlock(m))
      .sort((a, b) => (preference.get(a.symbol) ?? 1000) - (preference.get(b.symbol) ?? 1000) || a.symbol.localeCompare(b.symbol, "en"));
    for (const market of markets) {
      if (assets.length >= study.collection.maximumSymbols) break;
      const info = market.info as { listTime?: string; minSz?: string; lotSz?: string };
      if (Number(info.listTime) > start) { skipped.push({ symbol: market.symbol, reason: "listed_after_warmup_start" }); continue; }
      const constraints = { minimumNotionalUsdt: 0, minimumQuantity: Number(info.minSz), quantityStep: Number(info.lotSz) };
      if (!Number.isFinite(constraints.minimumQuantity) || constraints.minimumQuantity <= 0 || !Number.isFinite(constraints.quantityStep) || constraints.quantityStep <= 0) { skipped.push({ symbol: market.symbol, reason: "instrument_rules_unconfirmed" }); continue; }
      try {
        const history = await collectUniverseHistory(async request => {
          for (let attempt = 0; ; attempt++) {
            requests++; await wait(250);
            try { return await exchange.publicGetMarketHistoryCandles(request); }
            catch (error) {
              if (!(error instanceof ccxt.NetworkError) || attempt >= 2) throw error;
              await wait(1000 * 2 ** attempt);
            }
          }
        }, market.id!, start, end, Date.now());
        const dataset: UniverseDataset = { symbol: market.symbol, constraints, ...history };
        const filename = `${market.symbol.replace("/", "-")}.json`;
        await writeFile(join(directory!, filename), JSON.stringify(dataset) + "\n");
        assets.push({ symbol: market.symbol, filename, sha256: datasetHash(dataset) });
        console.log(`COLLECTED ${assets.length}/${study.collection.maximumSymbols} ${market.symbol} ${history.candles.length} candles`);
      } catch (error) {
        skipped.push({ symbol: market.symbol, reason: String(error) });
        console.log(`SKIPPED ${market.symbol}: ${String(error).slice(0, 200)}`);
        if (assets.length === 0 && skipped.filter(s => s.reason.includes("403") || s.reason.includes("451") || s.reason.includes("NetworkError")).length >= 3) throw new Error("Public OKX data inaccessible from this runner");
      }
    }
    const datasets = await Promise.all(assets.map(a => readFile(join(directory!, a.filename), "utf8").then(JSON.parse)));
    validateUniverseDatasets(datasets, study);
    await writeFile(sourcePath, JSON.stringify({ version: 1, complete: true, studySha256, capturedAtUtc, endExclusiveUtc: study.endExclusiveUtc,
      selection: "Predeclared preferred crypto symbols, then alphabetical current Spot/USDT instruments; stop at collection cap. No current tickers or future trade P&L used to select source pool.",
      requests, assets, skipped }, null, 2) + "\n");
  } finally { await exchange.close(); }
}
