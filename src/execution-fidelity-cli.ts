import { readFile } from "node:fs/promises";
import { executionFidelityReport, tradingTermsSchema } from "./execution-fidelity.js";
const [path, studyPath] = process.argv.slice(2);
if (!path || !studyPath) throw new Error("Usage: execution:fidelity -- <diagnostic-or-runtime.json> <universe-study.json>");
const input = JSON.parse(await readFile(path, "utf8"));
const runtime = input.executionFidelity ?? input;
if (!runtime.snapshot) throw new Error("No applied execution snapshot. Older diagnostics cannot establish current configuration; export after deploying runtime capture.");
const terms = tradingTermsSchema.parse(runtime.tradingTerms ?? { status: "unavailable", reason: "fee_unconfirmed" });
console.log(JSON.stringify(executionFidelityReport(runtime.snapshot, terms, JSON.parse(await readFile(studyPath, "utf8"))), null, 2));
