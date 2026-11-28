import { readFile } from "node:fs/promises";
import { assessIndependentValidationReadiness } from "./independent-validation.js";
import { assessCostIndependentReadiness, prepareCostIndependentFreeze } from "./cost-independent-validation.js";
const [path, financialPath, sourcePath, freezePath, ...extra] = process.argv.slice(2);
if (!path || extra.length || Boolean(financialPath) !== Boolean(sourcePath)) throw new Error("Usage: strategy:independent-readiness -- <legacy-report.json> OR <cost-report.json> <financial-summary.json> <original-source-study.json> [freeze.json]");
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const evidence = await json(path);
let report: unknown;
if (financialPath && sourcePath) {
  const financial = await json(financialPath), source = await json(sourcePath);
  // Fail on the evidence screen before even opening a proposed freeze file.
  const readiness = assessCostIndependentReadiness(evidence, financial, source);
  if (freezePath && readiness.status !== "frozen_protocol_required") throw new Error("No eligible development candidate: independent freeze blocked");
  report = freezePath ? prepareCostIndependentFreeze(await json(freezePath), evidence, financial, source) : readiness;
} else {
  if (evidence?.status === "cost_aware_development_experiments_only") throw new Error("Cost report requires financial summary and original source study");
  report = assessIndependentValidationReadiness(evidence);
}
console.log(JSON.stringify(report, null, 2));
