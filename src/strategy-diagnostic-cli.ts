import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { diagnosePaperExport, diagnosePortfolioReport } from "./strategy-diagnostic-input.js";

const [mode, path] = process.argv.slice(2);
if ((mode !== "--paper" && mode !== "--portfolio") || !path || process.argv.length !== 4) {
  throw new Error("Usage: strategy:diagnose -- <--paper|--portfolio> <export-or-complete-report.json>");
}
const raw = await readFile(path, "utf8");
const report = mode === "--paper" ? diagnosePaperExport(JSON.parse(raw)) : diagnosePortfolioReport(JSON.parse(raw));
console.log(JSON.stringify({ schemaVersion: 1, inputSha256: createHash("sha256").update(raw).digest("hex"), ...report }, null, 2));
