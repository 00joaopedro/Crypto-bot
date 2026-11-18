import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { REGIME_CANDLE_MS } from "./btc-regime.js";
import { comparePortfolio, portfolioLimitsSchema } from "./portfolio-comparison.js";
import { comparisonSchema } from "./strategy-comparison.js";
import type { Candle } from "./types.js";

const prepare = process.argv[2] === "--prepare";
const [studyPath, directory] = process.argv.slice(prepare ? 3 : 2);
if (!studyPath || !directory) {
  throw new Error("Usage: npm run strategy:study -- [--prepare] <study.json> <directory>");
}
const study = z.object({
  endExclusiveUtc: z.iso.datetime(),
  days: z.number().int().min(1).max(365),
  portfolio: portfolioLimitsSchema,
  comparison: comparisonSchema.omit({ symbol: true, constraints: true }).strict(),
  instruments: z.record(z.string().regex(/^[A-Z0-9]+\/USDT$/), comparisonSchema.shape.constraints),
}).strict().parse(await readJson(studyPath));
const end = Date.parse(study.endExclusiveUtc);
if (!Number.isSafeInteger(end) || end % REGIME_CANDLE_MS) throw new Error("Study end must align to a 15-minute UTC boundary");
const entries = Object.entries(study.instruments);
if (entries.length < 2) throw new Error("Study requires at least two instruments");
const names = entries.map(([symbol, constraints]) => ({
  options: comparisonSchema.parse({ ...study.comparison, symbol, constraints }),
  stem: symbol.replace("/", "-"),
}));

if (prepare) {
  await mkdir(directory);
  for (const { options, stem } of names) {
    await writeFile(join(directory, `${stem}.options.json`), JSON.stringify(options, null, 2) + "\n", { flag: "wx" });
  }
} else {
  const expectedCount = study.days * 96 + study.comparison.trainCandles;
  const datasets = await Promise.all(names.map(async ({ options, stem }) => {
    const input = await readJson(join(directory, `${stem}.json`)) as {
      candles: Candle[]; btcCandles?: Candle[]; options: unknown; metadata?: unknown;
    };
    const parsed = comparisonSchema.parse(input.options);
    if (!isDeepStrictEqual({ ...parsed, dataSource: options.dataSource }, options)) {
      throw new Error(`${stem}: dataset configuration does not match the study`);
    }
    if (!Array.isArray(input.candles) || input.candles.length !== expectedCount ||
        input.candles[0]?.timestamp !== end - expectedCount * REGIME_CANDLE_MS ||
        input.candles.at(-1)?.timestamp !== end - REGIME_CANDLE_MS) {
      throw new Error(`${stem}: dataset time range does not match the study`);
    }
    const series = z.object({ symbol: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
    const metadata = z.object({
      provider: z.literal("OKX"), market: z.literal("Spot"), timeframe: z.literal("15m"),
      primary: series, btcReference: series.optional(),
    }).parse(input.metadata);
    if (metadata.primary.symbol !== options.symbol || metadata.primary.sha256 !== hash(input.candles) ||
        (input.btcCandles && (metadata.btcReference?.symbol !== "BTC/USDT" || metadata.btcReference.sha256 !== hash(input.btcCandles))) ||
        (metadata.btcReference && !input.btcCandles)) {
      throw new Error(`${stem}: dataset does not match its collection metadata`);
    }
    return { ...input, options: parsed };
  }));
  console.log(JSON.stringify(comparePortfolio(datasets, study.portfolio), (_key, value: unknown) =>
    typeof value === "number" && !Number.isFinite(value) ? null : value, 2));
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function hash(value: Candle[]): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
