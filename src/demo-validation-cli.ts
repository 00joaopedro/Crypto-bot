import { readFile } from "node:fs/promises";
import { summarizeDemoValidation } from "./demo-validation-report.js";

const [start, ...paths] = process.argv.slice(2);
if (!start || paths.length === 0) {
  throw new Error("Usage: npm run demo:validation-report -- <start-utc> <diagnostic.json> [more-diagnostics.json ...]");
}
const inputs: unknown[] = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, "utf8"))));
console.log(JSON.stringify(summarizeDemoValidation(start, inputs), null, 2));
