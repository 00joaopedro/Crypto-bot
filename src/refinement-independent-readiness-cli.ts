import { readFile,writeFile,mkdir } from "node:fs/promises";
import { resolve,join } from "node:path";
import { assessRefinementIndependentReadiness,requireRefinementFreezeReadiness } from "./refinement-independent-readiness.js";
const args=process.argv.slice(2);
const [planPath,pullbackPath,exitPath,reversionPath,financialPath,sourceStudyPath,outDir,option,freezePath,...extra]=args;
if(!planPath||!pullbackPath||!exitPath||!reversionPath||!financialPath||!sourceStudyPath||!outDir||extra.length||(option!==undefined&&(option!=="--prepare-freeze"||!freezePath))||(!option&&freezePath))throw new Error("Usage: strategy:refinement-readiness -- <plan17.json> <pullback.json> <exit.json> <reversion.json> <financial.json> <original-study.json> <new-output-dir> [--prepare-freeze <proposal.json>]");
const paths=[planPath,pullbackPath,exitPath,reversionPath,financialPath,sourceStudyPath];
if(paths.some(p=>resolve(p)===resolve(join(outDir,"summary.json"))))throw new Error("Output must not replace evidence");
const json=async(p:string)=>JSON.parse(await readFile(p,"utf8"));
const report=assessRefinementIndependentReadiness(await Promise.all([pullbackPath,exitPath,reversionPath].map(json)),await json(financialPath),await json(planPath),await json(sourceStudyPath));
// Reject BEFORE opening any proposed freeze or independent input. No collection/replay is wired to this command.
if(option)requireRefinementFreezeReadiness(report);
await mkdir(outDir,{recursive:true});await writeFile(join(outDir,"summary.json"),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
