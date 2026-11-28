import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { universeStudySchema, compareUniverseSizes, datasetHash, type UniverseDataset } from "./universe-comparison.js";
import { MEAN_REVERSION_HYPOTHESIS } from "./mean-reversion-study.js";
const [manifest,directory]=process.argv.slice(2);
if(!manifest||!directory)throw new Error("Usage: strategy:complementary -- <original-study.json> <frozen-source-directory>");
const study=universeStudySchema.parse(JSON.parse(await readFile(manifest,"utf8")));
const source=JSON.parse(await readFile(join(directory,"source.json"),"utf8"));
if(!source.complete||source.studySha256!==createHash("sha256").update(JSON.stringify(study)).digest("hex"))throw new Error("Source/manifest mismatch");
const datasets:UniverseDataset[]=await Promise.all(source.assets.map(async(entry:{symbol:string;filename:string;sha256:string})=>{
 if(!/^[A-Z0-9._-]+-USDT\.json$/.test(entry.filename)||entry.filename!==entry.symbol.replace("/","-")+".json")throw new Error("Invalid source filename");
 const d=JSON.parse(await readFile(join(directory,entry.filename),"utf8"));
 if(d.symbol!==entry.symbol||datasetHash(d)!==entry.sha256)throw new Error("Dataset hash mismatch");return d;
}));
const outputs=(["trend","mean_reversion"] as const).map(entryModel=>({entryModel,report:compareUniverseSizes(datasets,{...study,sizes:[10,30]},entryModel)}));
console.log(JSON.stringify({status:"complementary_hypothesis_only",hypothesis:MEAN_REVERSION_HYPOTHESIS,sourceStudySha256:source.studySha256,
 limitations:["Already inspected data: exploratory, not an independent holdout.","Fixed ATR exits, BTC filter, portfolio limits and costs shared with trend. No middle-band target or ADX strategy is claimed.","Mean-reversion entries have score 8; ties use symbol order, not a calibrated cross-strategy ranking.","No combined portfolio, live strategy identity, order or configuration promotion. Trend and candidate are isolated wallets, not independent samples to pool."],outputs}));
