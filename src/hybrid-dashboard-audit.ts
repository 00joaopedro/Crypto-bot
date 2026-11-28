import { Worker } from 'node:worker_threads';
export function auditUploadedCheckpoint(raw:string):Promise<any>{
 if(Buffer.byteLength(raw)>16*1024*1024)throw new Error('Checkpoint exceeds16MiB');
 return new Promise((resolve,reject)=>{
  const source=import.meta.url.endsWith('.ts'),worker=new Worker(new URL(source?'./hybrid-dashboard-audit-worker.ts':'./hybrid-dashboard-audit-worker.js',import.meta.url),{workerData:raw,execArgv:source?['--import','tsx']:[],resourceLimits:{maxOldGenerationSizeMb:256}});
  let done=false;const finish=(result?:any)=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();if(result?.status==='checkpoint_replayed')resolve(result);else reject(new Error('Checkpoint audit failed'));};
  const timer=setTimeout(()=>finish(),60000);worker.once('message',finish);worker.once('error',()=>finish());worker.once('exit',()=>finish());
 });
}
