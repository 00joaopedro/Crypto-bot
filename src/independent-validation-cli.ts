import { readFile } from "node:fs/promises";
import { assessIndependentValidationReadiness } from "./independent-validation.js";
const [path]=process.argv.slice(2);
if(!path||process.argv.length!==3)throw new Error("Usage: strategy:independent-readiness -- <limited-experiments.json>");
console.log(JSON.stringify(assessIndependentValidationReadiness(JSON.parse(await readFile(path,"utf8"))),null,2));
