import "dotenv/config";
import { mkdir,writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createOkxReadOnlyClient,inspectOkxReadOnly } from "./okx-read-only-inspection.js";
const [environment,outPath,...symbols]=process.argv.slice(2);
if((environment!=='demo'&&environment!=='real')||!outPath||!symbols.length)throw new Error('Usage: account:inspect-readonly -- <demo|real> <new-private-output.json> <BTC/USDT> [ETH/USDT] [SOL/USDT]');
try{
 const client=createOkxReadOnlyClient({apiKey:process.env.OKX_READ_API_KEY??'',secretKey:process.env.OKX_READ_SECRET_KEY??'',passphrase:process.env.OKX_READ_PASSPHRASE??''},environment);
 const report=await inspectOkxReadOnly(client,environment,symbols);
 await mkdir(dirname(outPath),{recursive:true});await writeFile(outPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:report.status,environment,pairs:report.terms.length,ordersSent:0,privateOutputSaved:true}));
}catch{console.error('Read-only inspection unavailable. Check dedicated Read credentials, environment, connectivity and a new output path. No order, transfer or account change was requested.');process.exitCode=1;}
