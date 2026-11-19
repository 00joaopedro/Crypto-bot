import ccxt from "ccxt";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { collectOkxSpotHistory, OKX_HISTORY_ENDPOINT } from "./okx-history.js";
import { REGIME_CANDLE_MS } from "./btc-regime.js";
import { comparisonSchema } from "./strategy-comparison.js";
import { requiredWalkForwardWarmup } from "./walk-forward.js";

const [directory, endUtc, daysArg, ...optionPaths] = process.argv.slice(2);
if (!directory || !endUtc || !daysArg || optionPaths.length === 0) {
  throw new Error("Usage: npm run strategy:collect -- <new-output-directory> <end-utc> <days> <comparison.options.json> [more-options.json ...]");
}
const end = Date.parse(endUtc);
const days = Number(daysArg);
const now = Date.now();
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(endUtc) ||
    !Number.isSafeInteger(end) || end > now || end % REGIME_CANDLE_MS ||
    new Date(end).toISOString().replace(".000Z", "Z") !== endUtc.replace(".000Z", "Z")) {
  throw new Error("End must be a completed 15-minute UTC boundary, e.g. 2026-11-17T00:00:00Z");
}
if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new Error("Days must be an integer between 1 and 365");
const entries = await Promise.all(optionPaths.map(async path => {
  const options = comparisonSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (!/^[A-Z0-9]+\/USDT$/.test(options.symbol)) throw new Error(`Expected a Spot BASE/USDT symbol in ${path}`);
  if (options.testCandles > days * 96) throw new Error(`Evaluation window is shorter than testCandles in ${path}`);
  const variants = [options.baseline, ...options.alternatives.map(item => item.parameters)];
  const minimumWarmup = Math.max(...variants.map(variant => requiredWalkForwardWarmup({ qualityFilters: true }, [variant])));
  if (options.trainCandles < minimumWarmup) {
    throw new Error(`Comparison requires at least ${minimumWarmup} warmup candles in ${path}`);
  }
  const usesBtc = variants.some(variant => variant.btcRegimeFilter);
  return { options, usesBtc };
}));
if (new Set(entries.map(entry => entry.options.symbol)).size !== entries.length) throw new Error("Duplicate comparison symbols");

const exchange = new ccxt.okx({ enableRateLimit: true, options: { defaultType: "spot", fetchMarkets: { types: ["spot"] } } });
const evaluationStart = end - days * 96 * REGIME_CANDLE_MS;
const datasets = [];
try {
  const markets = await exchange.loadMarkets();
  const collect = async (symbol: string, start: number) => {
    const market = markets[symbol];
    const instrumentId = market?.id;
    if (!market?.spot || market.quote !== "USDT" || !instrumentId) throw new Error(`OKX Spot instrument unavailable: ${symbol}`);
    try {
      const candles = await collectOkxSpotHistory(async request => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await exchange.publicGetMarketHistoryCandles(request);
          } catch (error) {
            if (!(error instanceof ccxt.NetworkError) || attempt >= 2) throw error;
            await wait(1_000 * 2 ** attempt);
          }
        }
      }, instrumentId, start, end, now);
      return {
        candles,
        source: { symbol, instrumentId, count: candles.length, startUtc: new Date(start).toISOString(), sha256: hash(candles) },
      };
    } catch (error) {
      throw new Error(`${symbol}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  };

  const cache = new Map<string, Awaited<ReturnType<typeof collect>>>();
  const getHistory = async (symbol: string, start: number) => {
    const key = `${symbol}:${start}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const collected = await collect(symbol, start);
    cache.set(key, collected);
    return collected;
  };
  for (const { options, usesBtc } of entries) {
    const start = evaluationStart - options.trainCandles * REGIME_CANDLE_MS;
    const primary = await getHistory(options.symbol, start);
    const btc = usesBtc && options.symbol !== "BTC/USDT" ? await getHistory("BTC/USDT", start) : undefined;
    const metadata = {
      provider: "OKX", market: "Spot", endpoint: OKX_HISTORY_ENDPOINT, timeframe: "15m", volumeUnit: "base",
      capturedAtUtc: new Date(now).toISOString(), endExclusiveUtc: new Date(end).toISOString(),
      evaluationStartUtc: new Date(evaluationStart).toISOString(), warmupCandles: options.trainCandles,
      primary: primary.source, ...(btc ? { btcReference: btc.source } : {}),
    };
    datasets.push({
      filename: `${primary.source.instrumentId}.json`,
      report: {
        candles: primary.candles, ...(btc ? { btcCandles: btc.candles } : {}),
        options: { ...options, dataSource: `OKX Spot ${primary.source.instrumentId} ${OKX_HISTORY_ENDPOINT} 15m; candles sha256 ${primary.source.sha256}` },
        metadata,
      },
    });
  }
} finally {
  await exchange.close();
}

await mkdir(directory);
for (const { filename, report } of datasets) {
  await writeFile(join(directory, filename), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(`${filename}: ${report.candles.length} confirmed candles`);
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
