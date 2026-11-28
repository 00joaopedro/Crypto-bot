import { expect,it,vi } from 'vitest';
import { ShadowBatchCollector } from '../src/hybrid-shadow-collection.js';
import { MissingConfirmedCandleError } from '../src/okx-history.js';
const now=1800000,missing=()=>new MissingConfirmedCandleError(900000,900000);
it('retries a newly closed missing candle with bounded backoff and accepts only a complete frame',async()=>{
 const sleep=vi.fn(async(_ms:number,_signal:AbortSignal)=>{}),events:any[]=[],read=vi.fn().mockRejectedValueOnce(missing()).mockRejectedValueOnce(missing()).mockResolvedValue('closed');
 const c=new ShadowBatchCollector<string>({clock:()=>now,sleep,emit:e=>{events.push(e);}});
 expect(await c.collect('t',['BTC'],read,new AbortController().signal)).toEqual(['closed']);expect(sleep.mock.calls.map(c=>c[0])).toEqual([2000,4000]);expect(events.map(e=>e.event)).toEqual(['collection_retry','collection_retry']);
});
it('isolates a persistent pair failure, collects others, preserves order and reuses only same-target successful data',async()=>{
 let clock=now;const events:any[]=[],read=vi.fn(async(s:string)=>{if(s==='BTC')throw missing();return s;});
 const c=new ShadowBatchCollector<string>({clock:()=>clock,sleep:async()=>{},emit:e=>{events.push(e);}}),signal=new AbortController().signal;
 expect(await c.collect('t',['BTC','ETH'],read,signal)).toBeNull();expect(read.mock.calls.map(a=>a[0])).toEqual(['BTC','BTC','BTC','ETH']);
 expect(await c.collect('t',['BTC','ETH'],read,signal)).toBeNull();expect(read).toHaveBeenCalledTimes(4);
 clock+=60000;read.mockImplementation(async s=>s);expect(await c.collect('t',['BTC','ETH'],read,signal)).toEqual(['BTC','ETH']);expect(read).toHaveBeenCalledTimes(5);expect(events.at(-1).event).toBe('pair_recovered');
 expect(await c.collect('new-target',['BTC','ETH'],read,signal)).toEqual(['BTC','ETH']);expect(read).toHaveBeenCalledTimes(7);
});
it('does not retry corruption or accept a partial frame after an integrity error',async()=>{
 const c=new ShadowBatchCollector({sleep:async()=>{}}),read=vi.fn(async(s:string)=>{if(s==='ETH')throw new Error('Conflicting OKX candles');return s;});
 await expect(c.collect('t',['BTC','ETH'],read,new AbortController().signal)).rejects.toThrow(/Conflicting/);expect(read).toHaveBeenCalledTimes(2);
});
it('cancels during retry and never returns a frame collected after cancellation',async()=>{
 const controller=new AbortController(),read=vi.fn(async()=>{throw missing();});const c=new ShadowBatchCollector({clock:()=>now,sleep:async()=>{controller.abort();}});
 await expect(c.collect('t',['BTC'],read,controller.signal)).rejects.toThrow();expect(read).toHaveBeenCalledTimes(1);
 const other=new AbortController();await expect(new ShadowBatchCollector().collect('t',['BTC'],async()=>{other.abort();return 1;},other.signal)).rejects.toThrow();
});
it('does not repeatedly retry old missing history and rejects duplicate symbols',async()=>{
 const sleep=vi.fn(async()=>{}),read=vi.fn(async()=>{throw missing();});const c=new ShadowBatchCollector({clock:()=>now+9000000,sleep});
 expect(await c.collect('t',['BTC'],read,new AbortController().signal)).toBeNull();expect(read).toHaveBeenCalledTimes(1);expect(sleep).not.toHaveBeenCalled();
 await expect(c.collect('t',['BTC','BTC'],read,new AbortController().signal)).rejects.toThrow(/Distinct/);
});
it('bounds classified network failures and keeps error payloads out of telemetry',async()=>{
 const events:any[]=[],err={private:'SECRET'},read=vi.fn(async()=>{throw err;});const c=new ShadowBatchCollector({clock:()=>now,sleep:async()=>{},isNetworkError:e=>e===err,emit:e=>{events.push(e);}});
 expect(await c.collect('t',['BTC'],read,new AbortController().signal)).toBeNull();expect(read).toHaveBeenCalledTimes(3);expect(JSON.stringify(events)).not.toContain('SECRET');expect(events.at(-1).reason).toBe('network');
});
