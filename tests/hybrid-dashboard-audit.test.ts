import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { auditUploadedCheckpoint } from '../src/hybrid-dashboard-audit.js';
import { shadowConfiguration,startShadowSession } from '../src/hybrid-shadow-session.js';
import { createHash } from 'node:crypto';
import { startDashboard,stopDashboard } from '../src/dashboard.js';
import type { PostgresPersistence } from '../src/persistence.js';
import type { AddressInfo } from 'node:net';
const json=(p:string)=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const config=shadowConfiguration(json('examples/hybrid-shadow.profile.json'),json('examples/hybrid-research.plan.json'),json('examples/pullback-reference.study.json'));
export function checkpointFixture(){
 const q=Array.from({length:1000},(_,i)=>({timestamp:i*900000,open:100,high:101,low:99,close:100,volume:100})),hours=Array.from({length:250},(_,i)=>({timestamp:i*3600000,open:100,high:101,low:99,close:100,volume:400}));
 return startShadowSession(config,{asOfUtc:new Date(1000*900000).toISOString(),instruments:[{symbol:'BTC/USDT',candles15m:q,candles1h:hours,constraints:{minimumNotionalUsdt:0,minimumQuantity:.0001,quantityStep:.0001}}]},'a'.repeat(64),1000*900000);
}
it('replays a bounded checkpoint off-thread, preserving raw file hash and refusing live/real approval',async()=>{
 const raw=JSON.stringify(checkpointFixture())+'\n',r=await auditUploadedCheckpoint(raw);
 expect(r).toMatchObject({status:'checkpoint_replayed',sessionStatus:'warming',source:'manually_imported_checkpoint_not_live_monitoring',liveContinuityCertified:false,ordersSent:0,realMoneyApproved:false});expect(r.sourceFileSha256).toBe(createHash('sha256').update(raw).digest('hex'));expect(r.balance.finalEquityUsdt).toBe(17);
},15000);
const networkTest=process.env.CI?it:it.skip;
networkTest('authenticates the hybrid import, requires same-origin and never invokes legacy controls',async()=>{
 let controls=0;const persistence={setPaused:async()=>{controls++;return true;}} as unknown as PostgresPersistence;
 const server=await startDashboard({port:0,host:'127.0.0.1',password:'test-password',sessionSecret:'s'.repeat(32),persistence,supportedSymbols:[],onSettingsChanged(){controls++;}}),base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{
  expect((await fetch(base+'/api/hybrid-session')).status).toBe(401);
  const login=await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({password:'test-password'})}),headers={cookie:login.headers.get('set-cookie')!.split(';')[0]!,origin:base};
  expect(await(await fetch(base+'/api/hybrid-session',{headers})).json()).toMatchObject({status:'checkpoint_required'});
  expect((await fetch(base+'/api/hybrid-session',{method:'POST',headers:{...headers,origin:'https://invalid.example'},body:'{}'})).status).toBe(403);
  const result=await fetch(base+'/api/hybrid-session',{method:'POST',headers,body:JSON.stringify(checkpointFixture())});expect(result.status).toBe(200);expect(await result.json()).toMatchObject({status:'checkpoint_replayed',ordersSent:0});
  expect((await fetch(base+'/api/hybrid-session',{method:'POST',headers,body:'{}'})).status).toBe(409);
  expect(await(await fetch(base+'/api/hybrid-session',{headers})).json()).toMatchObject({status:'checkpoint_replayed'});expect(controls).toBe(0);
 }finally{await stopDashboard(server);}
},15000);
networkTest('invalid imported evidence leaves the prior session state untouched',async()=>{
 const server=await startDashboard({port:0,host:'127.0.0.1',password:'test-password',sessionSecret:'s'.repeat(32),persistence:{} as PostgresPersistence,supportedSymbols:[],onSettingsChanged(){}}),base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{const login=await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({password:'test-password'})}),headers={cookie:login.headers.get('set-cookie')!.split(';')[0]!,origin:base};
  const r=await fetch(base+'/api/hybrid-session',{method:'POST',headers,body:'{"result":{"netReturnUsdt":100}}'});expect(r.status).toBe(400);expect(await r.text()).not.toContain('/workspace');expect(await(await fetch(base+'/api/hybrid-session',{headers})).json()).toMatchObject({status:'checkpoint_required'});
 }finally{await stopDashboard(server);}
},15000);
it('rejects corrupted seals, arbitrary JSON and oversized input instead of accepting supplied PnL',async()=>{
 await expect(auditUploadedCheckpoint(JSON.stringify({...checkpointFixture(),result:{netReturnUsdt:100}}))).rejects.toThrow(/audit failed/);
 await expect(auditUploadedCheckpoint('{}')).rejects.toThrow(/audit failed/);expect(()=>auditUploadedCheckpoint('x'.repeat(16*1024*1024+1))).toThrow(/exceeds/);
},15000);
