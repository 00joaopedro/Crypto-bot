import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { ResearchMakerOrder } from '../src/maker-research-order.js';
import { makerPullbackChecks,validateMakerMicro,replayMakerPullback,type MakerMicro,type MakerSignal } from '../src/maker-pullback.js';
import { parseMakerMinutePage,collectMakerMinutes } from '../src/maker-public-minutes.js';
import { aggregateFourHours } from '../src/trend-horizon.js';
import type { HybridInstrument } from '../src/hybrid-research-replay.js';
const protocol=JSON.parse(readFileSync(new URL('../examples/maker-pullback.plan.json',import.meta.url),'utf8'));
const rules={minimumQuantity:.01,quantityStep:.001,priceTick:.01},time=1000*3600000;
const order=()=>new ResearchMakerOrder('one',100,1,0,300000,.001,rules);
it('rejects off-step/off-tick values without epsilon promotion and preserves decimal partial remainders',()=>{
 expect(()=>new ResearchMakerOrder('bad',100,.010000000001,0,300000,.001,{...rules,quantityStep:1e-8})).toThrow(/increment/);
 expect(()=>new ResearchMakerOrder('bad',100.001,1,0,300000,.001,rules)).toThrow(/increment/);
 const o=new ResearchMakerOrder('decimal',100,.3,0,300000,.001,{...rules,quantityStep:.1});o.fill('a',.1,0);expect(o.remainingQuantity).toBe(.2);o.fill('b',.2,60000);expect(o.status).toBe('filled');expect(o.reservedUsdt).toBe(0);
});
it('reserves cash, accounts partial base fees and releases only the unfilled reservation on timeout',()=>{
 const o=order();expect(o.reservedUsdt).toBe(100);o.fill('a',.5,0);expect(o.reservedUsdt).toBe(50);expect(o.receivedBase).toBe(.4995);expect(o.sellableQuantity).toBe(.499);o.expire(300000);expect(o.status).toBe('canceled');expect(o.reservedUsdt).toBe(0);expect(o.receivedBase).toBe(.4995);
});
it('deduplicates fills without double debit and rejects conflicting, late, oversized and post-cancel fills',()=>{
 const o=order();expect(o.fill('a',.5,0)).toBe(true);expect(o.fill('a',.5,0)).toBe(false);expect(o.spentUsdt).toBe(50);
 expect(()=>o.fill('a',.4,0)).toThrow(/Conflicting/);expect(()=>o.fill('b',.6,1)).toThrow(/Invalid/);expect(()=>o.fill('b',.1,300000)).toThrow(/Invalid/);o.cancel();expect(()=>o.fill('b',.1,2)).toThrow(/Invalid/);
});
it('reconciles maker-in-base/taker-in-quote/dust without charging the entry fee twice or closing twice',()=>{
 const o=order();o.fill('a',.5,0);o.fill('b',.5,60000);const r=o.close(110,.004,0);
 expect(r.proceedsUsdt).toBeCloseTo(.999*110*.996);expect(r.netPnlUsdt).toBeCloseTo(.999*110*.996-100);expect(r.feesUsdt).toBeCloseTo(.1+.999*110*.004);expect(r.dustQuantity).toBeCloseTo(0);expect(()=>o.close(110,.004,0)).toThrow(/invalid/);
});
it('never invents a sale for a subminimum partial after the base fee',()=>{
 const o=order();o.fill('a',.01,0);expect(o.unprotectablePartial).toBe(true);expect(()=>o.close(99,.004,.001)).toThrow(/Unprotectable/);
});
it('uses only closed4h context and a confirmed1h rejection; future macro bars cannot change the signal',()=>{
 const h=Array.from({length:1008},(_,i)=>({timestamp:i*3600000,open:100+i*.1,high:100.2+i*.1,low:99.9+i*.1,close:100.15+i*.1,volume:100}));
 h[999]={...h[999]!,open:200,close:200.1,high:200.2,low:197};const four=aggregateFourHours(h),f=makerPullbackChecks(h.slice(0,1000),four)!;
 expect(Object.values(f.checks).every(Boolean)).toBe(true);expect(makerPullbackChecks(h.slice(0,999),four)).toBeNull();for(let i=250;i<four.length;i++)four[i]!.close=1;expect(makerPullbackChecks(h.slice(0,1000),four)).toEqual(f);
 h[999]!.low=200;expect(makerPullbackChecks(h.slice(0,1000),four)!.checks.rejection).toBe(false);
});
function fixture(){
 const hours=Array.from({length:3160},(_,i)=>({timestamp:i*3600000,open:100,high:100.5,low:99.5,close:100,volume:6000}));
 const data={instruments:['BTC/USDT','ETH/USDT','SOL/USDT'].map(symbol=>({symbol,candles15m:hours.map(c=>({...c})),candles1h:[],constraints:{minimumQuantity:.00001,quantityStep:1e-8,minimumNotionalUsdt:0}})) as HybridInstrument[]};
 const signals:MakerSignal[]=[{symbol:'BTC/USDT',decisionTimestamp:time-3600000,entryHour:time,limit:99,stop:90,target:117}];
 const micro:MakerMicro={windows:[{symbol:'BTC/USDT',hour:time,candles:Array.from({length:60},(_,i)=>({timestamp:time+i*60000,open:100,high:100.5,low:99.5,close:100,volume:100}))}],publicRulesMatched:true,missing:[]};
 const sync=()=>{const bars=micro.windows[0]!.candles,h=data.instruments[0]!.candles15m[1000]!;h.open=bars[0]!.open;h.close=bars.at(-1)!.close;h.high=Math.max(...bars.map(c=>c.high));h.low=Math.min(...bars.map(c=>c.low));h.volume=bars.reduce((s,c)=>s+c.volume,0);};
 return {data,signals,micro,sync};
}
it('does not fill a touch, an expired trade-through, or an order crossed at the posting proxy',()=>{
 const f=fixture();for(const c of f.micro.windows[0]!.candles)c.low=99;f.sync();let r=replayMakerPullback(f.data,f.signals,f.micro,protocol,protocol.scenarios[0]);expect(r.closedTrades).toBe(0);expect('ordersWithFills'in r&&r.ordersWithFills).toBe(0);expect('feesUsdt'in r&&r.feesUsdt).toBe(0);
 f.micro.windows[0]!.candles[5]!.low=98;f.sync();r=replayMakerPullback(f.data,f.signals,f.micro,protocol,protocol.scenarios[0]);expect('ordersWithFills'in r&&r.ordersWithFills).toBe(0);
 f.signals[0]!.limit=101;f.signals[0]!.target=123;r=replayMakerPullback(f.data,f.signals,f.micro,protocol,protocol.scenarios[0]);expect('rejected'in r&&r.rejected.post_only_cross_proxy).toBe(1);
});
it('processes partial fills/timeout and pessimistic stop-first after the entry hour without duplicate target credit',()=>{
 const f=fixture();f.micro.windows[0]!.candles[0]!.low=98.5;f.micro.windows[0]!.candles[0]!.high=120;f.micro.windows[0]!.candles[0]!.volume=1;f.sync();
 f.data.instruments[0]!.candles15m[1001]={...f.data.instruments[0]!.candles15m[1001]!,high:120,low:89};
 const r=replayMakerPullback(f.data,f.signals,f.micro,protocol,protocol.scenarios[0]);expect(r.status).toBe('modeled_replay_complete');if(!('closedTradeLedger'in r))throw new Error('Expected ledger');
 expect(r.closedTradeLedger).toHaveLength(1);expect(r.closedTradeLedger[0]!.reason).toBe('STOP_LOSS');expect(r.closedTradeLedger[0]!.entryNotionalUsdt).toBeCloseTo(.099);expect(r.finalEquityUsdt-17).toBeCloseTo(r.realizedPnlUsdt);expect(r.orders[0]!.freeCashAfterReservationUsdt).toBeGreaterThan(0);expect(r.events.filter(e=>e.type==='maker_fill')).toHaveLength(1);expect(r.events.find(e=>e.type==='order_terminal')!.reservedUsdt).toBe(0);
});
it('uses gap stop prices and halts on an unprotectable partial instead of silently selling under minimum',()=>{
 const f=fixture();f.micro.windows[0]!.candles[0]!.low=98.5;f.sync();f.data.instruments[0]!.candles15m[1001]={...f.data.instruments[0]!.candles15m[1001]!,open:85,low:84};
 let r=replayMakerPullback(f.data,f.signals,f.micro,protocol,protocol.scenarios[0]);if(!('closedTradeLedger'in r))throw new Error('Expected ledger');expect(r.closedTradeLedger[0]!.exitPrice).toBeLessThan(85);
 f.micro.windows[0]!.candles[0]!.volume=.01;f.sync();r=replayMakerPullback(f.data,f.signals,f.micro,protocol,protocol.scenarios[0]);expect(r.status).toBe('blocked_unprotectable_partial');expect(r.closedTrades).toBe(0);expect('openPosition'in r&&r.openPosition).not.toBeNull();
});
it('blocks missing minute coverage and rejects duplicates/hour disagreement instead of generating hourly fills',()=>{
 const f=fixture();expect(replayMakerPullback(f.data,f.signals,{windows:[],missing:[],publicRulesMatched:false},protocol,protocol.scenarios[0]).status).toBe('blocked_missing_minute_data');
 f.micro.windows.push(f.micro.windows[0]!);expect(()=>validateMakerMicro(f.data,f.signals,f.micro)).toThrow(/Duplicate/);f.micro.windows.pop();f.micro.windows[0]!.candles[0]!.high=101;expect(()=>validateMakerMicro(f.data,f.signals,f.micro)).toThrow(/disagree/);
});
it('parses confirmed minute pages, tolerates identical pagination duplicates and refuses gaps/conflicts/unconfirmed bars',()=>{
 const rows=Array.from({length:60},(_,i)=>[String(time+i*60000),'100','101','99','100','10','1000','1000','1']);const payload={code:'0',data:[...rows,rows[0]]};expect(parseMakerMinutePage(payload,time)).toHaveLength(60);
 expect(()=>parseMakerMinutePage({code:'0',data:rows.slice(1)},time)).toThrow(/Missing/);const bad=structuredClone(rows);bad[0]![8]='0';expect(()=>parseMakerMinutePage({code:'0',data:bad},time)).toThrow(/Unconfirmed/);expect(()=>parseMakerMinutePage({code:'0',data:[...rows,[...rows[0]!.slice(0,2),'102',...rows[0]!.slice(3)]]},time)).toThrow(/Conflicting/);
});
it('collects through two public GET routes without credentials/orders and retains unavailable windows as missing',async()=>{
 const calls:string[]=[];const transport=(async(input:any,init:any)=>{calls.push(String(input));expect(init.method).toBe('GET');expect(init.headers).toBeUndefined();return {status:200,json:async()=>({code:'0',data:[]})};}) as typeof fetch;
 const f=fixture(),micro=await collectMakerMinutes(f.signals,protocol.rules,transport,async()=>{});expect(micro.windows).toHaveLength(0);expect(micro.missing).toHaveLength(1);expect(micro.publicRulesMatched).toBe(false);expect(calls.every(c=>c.startsWith('https://openapi.okx.com/api/v5/'))).toBe(true);
});
