import { startSessionExport } from './session-export-server.js';
const [directory,...extra]=process.argv.slice(2),port=Number(process.env.PORT??8080);
if(directory!=='/data/hybrid-shadow-48h'||extra.length||!Number.isInteger(port)||port<1||port>65535)throw new Error('Usage: session:export -- /data/hybrid-shadow-48h; read only');
const server=await startSessionExport({directory,password:process.env.DASHBOARD_PASSWORD??'',sessionSecret:process.env.DASHBOARD_SESSION_SECRET??'',port});
console.log(JSON.stringify({event:'session_export_ready',readOnly:true,ordersSent:0}));
for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>server.close(()=>process.exit(0)));
