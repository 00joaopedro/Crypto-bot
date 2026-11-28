import { open,mkdir,readFile,rename,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ShadowSnapshot } from './hybrid-shadow-session.js';
/** One owner for the entire session; a crash leaves a lock requiring explicit operator recovery. */
export async function lockShadowSession(directory:string){
 await mkdir(directory,{recursive:true,mode:0o700});
 const path=join(directory,'session.lock'),handle=await open(path,'wx',0o600);
 try{await handle.writeFile(JSON.stringify({pid:process.pid,createdAtUtc:new Date().toISOString()})+'\n');await handle.sync();}catch(e){await handle.close();throw e;}
 return async()=>{await handle.close();await unlink(path);};
}
export async function readShadowCheckpoint(directory:string):Promise<ShadowSnapshot|null>{
 try{return JSON.parse(await readFile(join(directory,'checkpoint.json'),'utf8')) as ShadowSnapshot;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
}
export async function saveShadowCheckpoint(directory:string,state:ShadowSnapshot){return saveShadowArtifact(directory,'checkpoint.json',state);}
export async function saveShadowArtifact(directory:string,name:'checkpoint.json'|'diagnostics.json'|'collection-health.json'|'current-instruments.json',state:unknown){
 const temporary=join(directory,'checkpoint-'+randomUUID()+'.tmp'),destination=join(directory,name);
 const f=await open(temporary,'wx',0o600);
 try{await f.writeFile(JSON.stringify(state)+'\n');await f.sync();}finally{await f.close();}
 await rename(temporary,destination);
 const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
}
