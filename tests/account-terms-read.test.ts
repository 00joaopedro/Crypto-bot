import { expect,it,vi } from 'vitest';
import { createAccountTermsRead } from '../src/account-terms-read.js';
const env={OKX_READ_API_KEY:'PRIVATE_READ_KEY',OKX_READ_SECRET_KEY:'PRIVATE_READ_SECRET',OKX_READ_PASSPHRASE:'PRIVATE_READ_PASSPHRASE',OKX_READ_ENVIRONMENT:'real'};
function transport(){return vi.fn(async(input:any,init:any)=>{
 const path=new URL(String(input)).pathname;
 const data=path.endsWith('/config')?[{perm:'read_only',acctLv:'1',enableSpotBorrow:false,autoLoan:false,uid:'PRIVATE_ACCOUNT_ID',feeType:'1'}]:path.endsWith('/balance')?[{details:[{ccy:'USDT',availBal:'17',cashBal:'17',liab:'0'}]}]:path.endsWith('/instruments')?['BTC','ETH','SOL'].map(s=>({instId:s+'-USDT',instType:'SPOT',quoteCcy:'USDT',state:'live',minSz:'.001',lotSz:'.001',tickSz:'.1'})):[{instType:'SPOT',taker:'-.001'}];
 expect(init.method).toBe('GET');expect(init.signal).toBeInstanceOf(AbortSignal);return {ok:true,json:async()=>({code:'0',data})} as Response;
});}
it('requires dedicated Read variables and explicit environment, never reusing operational keys',async()=>{
 const fetch=transport(),read=createAccountTermsRead({OKX_API_KEY:'PRIVATE_TRADE_KEY',OKX_SECRET_KEY:'PRIVATE_TRADE_SECRET',OKX_PASSPHRASE:'PRIVATE_TRADE_PASSPHRASE'},fetch as typeof globalThis.fetch);
 expect(await read()).toMatchObject({status:'not_configured',ordersSent:0});expect(fetch).not.toHaveBeenCalled();
 expect(await createAccountTermsRead({...env,OKX_READ_ENVIRONMENT:'wrong'},fetch as typeof globalThis.fetch)()).toMatchObject({status:'not_configured'});expect(fetch).not.toHaveBeenCalled();
});
it('shares an in-flight read, caches for 60 seconds, projects only allowed data and fixes the selected environment',async()=>{
 let now=Date.parse('2026-11-22T22:00:00Z');const fetch=transport(),settings={...env},read=createAccountTermsRead(settings,fetch as typeof globalThis.fetch,()=>new Date(now));settings.OKX_READ_ENVIRONMENT='demo';
 const [a,b]=await Promise.all([read(),read()]);expect(a).toBe(b);expect(fetch).toHaveBeenCalledTimes(6);expect(a).toMatchObject({environment:'real',entryFeeCurrency:'quote',ordersSent:0,balance:{withinDeclaredBudgetUsdt:17}});
 expect(JSON.stringify(a)).not.toMatch(/PRIVATE_/);expect(await read()).toBe(a);expect(fetch).toHaveBeenCalledTimes(6);
 now+=60001;await read();expect(fetch).toHaveBeenCalledTimes(12);expect(fetch.mock.calls.every(c=>!c[1].headers['x-simulated-trading'])).toBe(true);
});
it('suppresses raw network errors and credentials and bounds retries through a cached failure',async()=>{
 const fetch=vi.fn(async()=>{throw new Error(env.OKX_READ_SECRET_KEY);}),read=createAccountTermsRead(env,fetch as typeof globalThis.fetch);
 const a=await read();expect(a).toEqual({status:'unavailable',reason:'read_query_failed',environment:'real',ordersSent:0});expect(JSON.stringify(a)).not.toContain(env.OKX_READ_SECRET_KEY);await read();expect(fetch).toHaveBeenCalledTimes(1);
});
it('rejects Trade permissions with a clear safe error before querying balance or fees',async()=>{
 const fetch=vi.fn(async()=>({ok:true,json:async()=>({code:'0',data:[{perm:'read_only,trade'}]})}) as Response),read=createAccountTermsRead(env,fetch as typeof globalThis.fetch);
 expect(await read()).toMatchObject({status:'unavailable',reason:'dedicated_read_key_required',ordersSent:0});expect(fetch).toHaveBeenCalledTimes(1);
});
