import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { effectiveExecutionSnapshot } from "../src/execution-fidelity.js";
it("compares exported evidence offline, rejects unattributed legacy input and detects tampering", () => {
  const directory = mkdtempSync(join(tmpdir(), "fidelity-"));
  try {
    const path = join(directory, "runtime.json");
    const snapshot = effectiveExecutionSnapshot(parseConfig({}), { symbol: "BTC/USDT", orderSizeUsdt: 10, maxConcurrentPositions: 10, maxTrades: 10, intervalMinutes: 15 }, undefined);
    const input = { records: [], executionFidelity: { snapshot, tradingTerms: { status: "unavailable", reason: "fee_unconfirmed" } } };
    writeFileSync(path, JSON.stringify(input));
    const run = () => execFileSync(process.execPath, ["--import", "tsx", new URL("../src/execution-fidelity-cli.ts", import.meta.url).pathname, path,
      new URL("../examples/universe-validation.study.json", import.meta.url).pathname], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const report = JSON.parse(run());
    expect(report.status).toBe("equivalence_not_established");
    expect(report.findings.some((f: { id: string }) => f.id === "legacy_trailing_mismatch")).toBe(true);
    writeFileSync(path, JSON.stringify({ records: [] }));
    expect(run).toThrow(/No applied execution snapshot/);
    input.executionFidelity.snapshot.settings.demoOrderCeilingUsdt = 55;
    writeFileSync(path, JSON.stringify(input));
    expect(run).toThrow(/hash mismatch/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 15000);
