import { mkdtemp,writeFile,readFile,rm,symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach,expect,it } from 'vitest';
import { startSessionExport } from '../src/session-export-server.js';
import { createSessionCookie } from '../src/dashboard-session.js';
let server:Awaited<ReturnType<typeof startSessionExport>>|undefined,dir:string;
afterEach(async()=>{if(server)await new Promise<void>(r=>server!.close(()=>r()));server=undefined;if(dir)await rm(dir,{recursive:true,force:true});});
async function setup(){dir=await mkdtemp(join(tmpdir(),'session-export-'));server=await startSessionExport({directory:dir,password:'test-password',sessionSecret:'s'.repeat(32),port:0,host:'127.0.0.1'});return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;}
const auth={cookie:createSessionCookie('s'.repeat(32)).split(';')[0]!};
it('fails closed without configured dashboard authentication',async()=>{
 await expect(startSessionExport({directory:'/',password:'',sessionSecret:'',port:0})).rejects.toThrow(/authentication/);
});
it('requires authentication and same-origin login, creates the existing secure12h session',async()=>{
 const base=await setup();expect((await fetch(base+'/files/checkpoint.json')).status).toBe(401);expect(await(await fetch(base+'/')).text()).toContain('type="password"');
 expect((await fetch(base+'/login',{method:'POST',headers:{origin:'https://other.example'},body:'password=test-password'})).status).toBe(403);
 expect((await fetch(base+'/login',{method:'POST',headers:{origin:'null'},body:'password=test-password'})).status).toBe(403);
 const bad=await fetch(base+'/login',{method:'POST',headers:{origin:base},body:'password=wrong'});expect(bad.status).toBe(401);
 const login=await fetch(base+'/login',{method:'POST',headers:{origin:base},body:'password=test-password',redirect:'manual'});expect(login.status).toBe(303);expect(login.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax; Secure');expect(login.headers.get('set-cookie')).toContain('Max-Age=43200');
});
it('streams only the exact original file bytes as a protected attachment and never changes the source',async()=>{
 const base=await setup(),raw='{"checkpointSha256":"original evidence"}\n';await writeFile(join(dir,'checkpoint.json'),raw);await writeFile(join(dir,'public-coverage.json'),'{}\n');
 for(const file of ['checkpoint.json','public-coverage.json']){const r=await fetch(base+'/files/'+file,{headers:auth});expect(r.status).toBe(200);expect(r.headers.get('content-disposition')).toBe(`attachment; filename="${file}"`);expect(r.headers.get('cache-control')).toBe('no-store');expect(await r.text()).toBe(await readFile(join(dir,file),'utf8'));}
 expect(await readFile(join(dir,'checkpoint.json'),'utf8')).toBe(raw);expect(await(await fetch(base+'/',{headers:auth})).text()).toContain('não executa o bot');
});
it('refuses arbitrary filenames, traversal, symlinks and missing files without exposing paths',async()=>{
 const base=await setup();await writeFile(join(dir,'private.txt'),'should not export');
 for(const name of ['private.txt','%2e%2e%2fprivate.txt','missing.json']){const r=await fetch(base+'/files/'+name,{headers:auth});expect(r.status).toBe(404);expect(await r.text()).not.toContain('should not export');}
 await symlink(join(dir,'private.txt'),join(dir,'checkpoint.json'));const r=await fetch(base+'/files/checkpoint.json',{headers:auth});expect(r.status).toBe(404);expect(await r.text()).not.toContain(dir);
});
it('bounds login bodies and exposes no filesystem data on public health',async()=>{
 const base=await setup();const r=await fetch(base+'/login',{method:'POST',headers:{origin:base},body:'x'.repeat(4097)});expect(r.status).toBe(413);expect(await(await fetch(base+'/health')).json()).toEqual({status:'read_only_export',ordersSent:0});
});
