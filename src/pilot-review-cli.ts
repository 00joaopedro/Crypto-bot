import { readFile } from "node:fs/promises";
import { pilotReview } from "./pilot-review.js";
const [developmentPath,evidencePath]=process.argv.slice(2);
if(!developmentPath||process.argv.length>4)throw new Error("Usage: pilot:review -- <limited-experiments.json> [evidence.json]");
const evidence=evidencePath?JSON.parse(await readFile(evidencePath,"utf8")):{};
// Explicit projection: evidence file cannot replace development results or leak unrelated fields.
console.log(JSON.stringify(pilotReview({development:JSON.parse(await readFile(developmentPath,"utf8")),
 ...(evidence.demoStartUtc?{demoStartUtc:evidence.demoStartUtc}:{}),...(evidence.demoExports?{demoExports:evidence.demoExports}:{}),
 ...(evidence.snapshots?{snapshots:evidence.snapshots}:{}),...(evidence.matchedExecutions?{matchedExecutions:evidence.matchedExecutions}:{}),
 ...(evidence.capital?{capital:evidence.capital}:{})}),null,2));
