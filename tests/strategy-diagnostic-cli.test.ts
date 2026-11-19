import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";

it("produces an offline diagnostic with input identity and rejects unsupported/incomplete input", () => {
  const directory = mkdtempSync(join(tmpdir(), "diagnose-cli-"));
  try {
    const path = join(directory, "input.json");
    const raw = JSON.stringify({ records: [], secretsNotForReport: "PRIVATE_SENTINEL" });
    writeFileSync(path, raw);
    const run = (mode: string) => execFileSync(process.execPath, ["--import", "tsx", new URL("../src/strategy-diagnostic-cli.ts", import.meta.url).pathname, mode, path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const output = run("--paper");
    expect(output).not.toContain("PRIVATE_SENTINEL");
    expect(JSON.parse(output)).toMatchObject({ inputSha256: createHash("sha256").update(raw).digest("hex"), summary: { closedTrades: 0 } });
    expect(() => run("--unknown")).toThrow(/Usage/);
    expect(() => run("--portfolio")).toThrow();
    writeFileSync(path, "not-json");
    expect(() => run("--paper")).toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 15000);
