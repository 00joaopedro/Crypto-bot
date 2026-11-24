import { afterEach,expect,it } from 'vitest';
import { OkxCandleStream,OKX_CANDLE_WS,type CandleSocket } from '../src/okx-candle-stream.js';
class Socket implements CandleSocket{readyState=0;sent:string[]=[];listeners=new Map<string,Array<(e:any)=>void>>();send(v:string){this.sent.push(v);}close(){this.readyState=3;this.emit('close',{});}addEventListener(t:string,f:(e:any)=>void){this.listeners.set(t,[...(this.listeners.get(t)??[]),f]);}emit(t:string,e:any){for(const f of this.listeners.get(t)??[])f(e);}open(){this.readyState=1;this.emit('open',{});}message(p:unknown){this.emit('message',{data:typeof p==='string'?p:JSON.stringify(p)});}}
const active:OkxCandleStream[]=[];afterEach(()=>{for(const c of active)c.stop();active.length=0;});
function fixture(){let now=3600000;const sockets:Socket[]=[],events:any[]=[];const c=new OkxCandleStream(['BTC/USDT'],{clock:()=>now,socketFactory:url=>{expect(url).toBe(OKX_CANDLE_WS);const s=new Socket();sockets.push(s);return s;},emit:e=>events.push(e)});active.push(c);c.start();const s=sockets[0]!;s.open();for(const channel of ['candle15m','candle1H'])s.message({event:'subscribe',arg:{channel,instId:'BTC-USDT'}});return {c,s,sockets,events,advance:(ms:number)=>{now+=ms;}};}
const row=(t:number,confirm='1',close='11')=>[String(t),'10','12','9',close,'1','10','10',confirm];
const message=(rows:string[][],instId='BTC-USDT')=>({arg:{channel:'candle15m',instId},data:rows});
it('subscribes only approved 15m/1h pairs, ignores open candles and orders closed out-of-order data',()=>{
 const {c,s}=fixture();expect(JSON.parse(s.sent[0]!).args).toEqual([{channel:'candle15m',instId:'BTC-USDT'},{channel:'candle1H',instId:'BTC-USDT'}]);
 s.message(message([row(2700000,'0')]));expect(c.pageBefore('BTC-USDT','15m',3600000,300)).toBeNull();
 s.message(message([row(2700000),row(900000),row(1800000)]));expect(c.pageBefore('BTC-USDT','15m',3600000,300)!.map(r=>Number(r[0]))).toEqual([2700000,1800000,900000]);expect(c.summary().openRowsIgnored).toBe(1);
});
it('deduplicates identical confirmed rows and refuses conflicting corrections rather than overwriting',()=>{
 const {c,s}=fixture();s.message(message([row(2700000),row(2700000)]));expect(c.summary().duplicates).toBe(1);
 s.message(message([row(2700000,'1','12')]));expect(c.summary().integrityFault).toBe(true);expect(()=>c.pageBefore('BTC-USDT','15m',3600000,300)).toThrow(/Conflicting|invalid/);
});
it('repairs missing prefixes using REST and compares confirmed overlap across transports',()=>{
 const {c,s}=fixture();s.message(message([row(1800000)]));expect(c.pageBefore('BTC-USDT','15m',3600000,300)).toBeNull();
 c.acceptRestPage('BTC-USDT','15m',{code:'0',data:[row(2700000),row(1800000)]});expect(c.pageBefore('BTC-USDT','15m',3600000,300)).toHaveLength(2);
 expect(()=>c.acceptRestPage('BTC-USDT','15m',{code:'0',data:[row(2700000,'1','12')]})).toThrow(/Conflicting/);
});
it('uses idle ping/pong, reconnects with backoff after timeout and ignores retired socket messages',()=>{
 const f=fixture();f.advance(20000);f.c.tick();expect(f.s.sent.at(-1)).toBe('ping');f.s.message('pong');f.advance(20000);f.c.tick();expect(f.c.summary().connected).toBe(true);
 f.advance(20000);f.c.tick();expect(f.c.summary().connected).toBe(false);f.advance(1000);f.c.tick();expect(f.sockets).toHaveLength(2);
 f.s.message(message([row(2700000)]));expect(f.c.pageBefore('BTC-USDT','15m',3600000,300)).toBeNull();
 f.c.stop();f.advance(60000);f.c.tick();expect(f.sockets).toHaveLength(2);
});
it('never accepts future confirmations, unsolicited markets or arbitrary channels',()=>{
 const {c,s}=fixture();s.message(message([row(3600000)]));s.message(message([row(2700000)],'ETH-USDT'));s.message({arg:{channel:'candle5m',instId:'BTC-USDT'},data:[row(2700000)]});
 expect(c.pageBefore('BTC-USDT','15m',3600000,300)).toBeNull();expect(c.summary().futureRowsIgnored).toBe(1);expect(()=>new OkxCandleStream(['USDC/USDT'])).toThrow(/watchlist/);
});
it('degrades subscription errors safely while preserving REST fallback and never logs raw payloads',()=>{
 const {c,s,events}=fixture();s.message({event:'error',code:'60012',msg:'PRIVATE_SENTINEL'});expect(c.summary().disabled).toBe(true);expect(JSON.stringify(events)).not.toContain('PRIVATE_SENTINEL');
 c.acceptRestPage('BTC-USDT','15m',{code:'0',data:[row(2700000)]});expect(c.pageBefore('BTC-USDT','15m',3600000,1)).toHaveLength(1);
});
it('bounds per-market retention and rejects malformed confirmed data',()=>{
 const {c,s,advance}=fixture();advance(500*900000);s.message(message(Array.from({length:500},(_,i)=>row(i*900000))));expect(c.pageBefore('BTC-USDT','15m',900000,1)).toBeNull();
 s.message(message([['0','bad','12','9','11','1','10','10','1']]));expect(c.summary().integrityFault).toBe(true);
});

it('handles a failed subscription send and a stalled handshake without throwing into the process',()=>{
 let now=1000;const sockets:Socket[]=[],c=new OkxCandleStream(['BTC/USDT'],{clock:()=>now,socketFactory:()=>{const s=new Socket();sockets.push(s);return s;}});active.push(c);c.start();
 now+=20000;expect(()=>c.tick()).not.toThrow();expect(sockets[0]!.readyState).toBe(3);now+=1000;c.tick();const next=sockets[1]!;next.send=()=>{throw new Error('closed');};expect(()=>next.open()).not.toThrow();expect(c.summary().connected).toBe(false);
});
