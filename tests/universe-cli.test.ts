import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { universeStudySchema, datasetHash } from "../src/universe-comparison.js";

it("reproduces a frozen local study, reuses its source and rejects a modified dataset", () => {
  const directory = mkdtempSync(join(tmpdir(), "universe-cli-"));
  try {
    const base = JSON.parse(readFileSync(new URL("../examples/universe-validation.study.json", import.meta.url), "utf8"));
    const study = universeStudySchema.parse({ ...base, warmupCandles: 100, sizes: [1, 2, 0], parameters: { ...base.parameters, btcRegimeFilter: false } });
    const manifest = join(directory, "study.json");
    writeFileSync(manifest, JSON.stringify(study));
    const start = Date.parse(study.endExclusiveUtc) - 2980 * 900000;
    const candles = Array.from({ length: 2980 }, (_, i) => ({ timestamp: start + i * 900000, open: 100, high: 101, low: 99, close: 100, volume: 1000 }));
    const assets = ["BTC/USDT", "ETH/USDT"].map(symbol => {
      const dataset = { symbol, constraints: { minimumNotionalUsdt: 0, minimumQuantity: .01, quantityStep: .01 }, candles, quoteVolumesUsdt: candles.map(() => 100000) };
      const filename = symbol.replace("/", "-") + ".json";
      writeFileSync(join(directory, filename), JSON.stringify(dataset));
      return { symbol, filename, sha256: datasetHash(dataset) };
    });
    writeFileSync(join(directory, "source.json"), JSON.stringify({ complete: true, studySha256: createHash("sha256").update(JSON.stringify(study)).digest("hex"), assets, skipped: [] }));
    const cli = new URL("../src/universe-study-cli.ts", import.meta.url).pathname;
    const run = (...args: string[]) => execFileSync(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(run("--collect", manifest, directory)).toContain("Reusing frozen source");
    run(manifest, directory);
    const report = JSON.parse(readFileSync(join(directory, "summary.json"), "utf8"));
    expect(report.coverage.validatedAssets).toBe(2);
    expect(report.assets).toHaveLength(2);
    expect(report.results.map((r: { size: number }) => r.size)).toEqual([1, 2, 0]);
    expect(report.results[0].scenarios[0].result.blocks[0].perSymbol).toBeUndefined();
    const altered = JSON.parse(readFileSync(join(directory, assets[0]!.filename), "utf8"));
    altered.quoteVolumesUsdt[100]++;
    writeFileSync(join(directory, assets[0]!.filename), JSON.stringify(altered));
    expect(() => run(manifest, directory)).toThrow(/hash mismatch/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 15000);
