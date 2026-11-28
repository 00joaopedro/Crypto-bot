import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { quantizeQuantityDown } from '../src/decimal-quantity.js';
import { SwingV2Position,swingLevels,swingSellable,exitFriction } from '../src/swing-v2-ledger.js';
import { swingChecks,ceilTick,type SwingData,type SwingSignal } from '../src/swing-v2-signals.js';
import { replaySwingV2,screenSwingV2,validateSwingMicro } from '../src/swing-v2-replay.js';
import { aggregateFourHours } from '../src/trend-horizon.js';
import type { MakerMicro } from '../src/maker-pullback.js';
const p=JSON.parse(readFileSync(new URL('../examples/swing-v2.plan.json',import.meta.url),'utf8')),s=p.scenarios[0],rules=p.rules['BTC/USDT'];
function complete(r:ReturnType<typeof replaySwingV2>){if(!('closedTrades' in r))throw new Error('Unexpected missing minute evidence');return r;}
const pos=()=>new SwingV2Position('BTC/USDT',100,98,.02,0,rules,s);
it('constructs1.60R NET target including maker fee, dust and reserve while keeping activation below target',()=>{
 const q=pos();q.buyFill('a',.02,0);const levels=swingLevels(q.buy.spentUsdt,q.remaining,100,98,rules,s);expect(levels.netRewardRisk).toBeGreaterThanOrEqual(1.6);expect(q.activationPrice).toBeLessThan(q.target);expect(q.target).toBeGreaterThan(100);expect(ceilTick(100.10001,.1)).toBe(100.2);
});
it('charges maker at the resting limit, not at a worse fictitious maker price; reserve is separate from fees',()=>{
 const q=pos();q.buyFill('a',.02,0);expect(()=>q.sellFill('bad',q.remaining,q.target,'maker')).toThrow(/rest/);q.postTarget(101,60000);expect(()=>q.sellFill('bad',q.remaining,q.target-.1,'maker')).toThrow(/limit/);
 const out=q.sellFill('tp',q.remaining,q.target,'maker')!;expect(out.price).toBe(q.target);expect(out.fee).toBeCloseTo(out.quantity*out.price*.001);expect(out.reserve).toBeGreaterThan(0);expect(q.netPnl).toBeGreaterThanOrEqual(1.6*q.initialRisk);expect(q.fees).toBeCloseTo(.002+out.fee);
});
it('keeps partial target inventory, prevents duplicate debits and cancels any remaining buy',()=>{
 const q=pos();q.buyFill('a',.01,0);q.postTarget(101,60000);
 const amount=.001;const out=q.sellFill('tp1',amount,q.target,'maker');expect(out).not.toBeNull();expect(q.buy.status).toBe('canceled');expect(q.buy.reservedUsdt).toBe(0);expect(q.closed).toBe(false);
 expect(q.sellFill('tp1',amount,q.target,'maker')).toBeNull();expect(()=>q.sellFill('tp1',amount+.0001,q.target,'maker')).toThrow(/Conflicting/);expect(()=>q.buyFill('new',.001,60000)).toThrow(/grow/);expect(q.buyFill('a',.01,0)).toBe(false);
 const stop=q.sellFill('sl',q.remaining,98*(1-exitFriction(s)),'taker')!;expect(q.closed).toBe(true);expect(q.netPnl).toBeCloseTo(out!.net+stop.net-q.buy.spentUsdt);
});
it('moves protection using net1R to net+0.15R, rounds upward and cancels pending entry',()=>{
 const q=pos();q.buyFill('a',.01,0);expect(q.protectAtClose(100.5)).toBeNull();const activation=q.activationPrice,stop=q.protectAtClose(activation+.1)!;expect(stop).toBeGreaterThan(100);expect(q.buy.status).toBe('canceled');
 const net=q.proceeds+q.remaining*stop*(1-s.takerRate)*(1-exitFriction(s))-q.buy.spentUsdt;expect(net).toBeGreaterThanOrEqual(.15*q.initialRisk-1e-10);expect(q.protectAtClose(120)).toBeNull();
});
it('does not fabricate liquidation for subminimum target remainder or base-fee residue',()=>{
 const q=new SwingV2Position('SOL/USDT',100,98,.02,0,p.rules['SOL/USDT'],s);q.buyFill('a',.02,0);q.postTarget(101,60000);q.sellFill('part',.01,q.target,'maker');expect(q.unprotectable).toBe(true);expect(()=>q.sellFill('sl',q.remaining,98,'taker')).toThrow(/Invalid/);
 const tiny=new SwingV2Position('SOL/USDT',100,98,.01,0,p.rules['SOL/USDT'],s);tiny.buyFill('a',.01,0);expect(tiny.unprotectable).toBe(true);
});
it('enforces60-minute expiry and decimal sellable consistency',()=>{
 const q=pos();expect(q.buy.expiresAt).toBe(3600000);q.buyFill('a',.02,3540000);expect(q.remaining).toBe(swingSellable(.02,.001,rules.quantityStep));expect(()=>q.buyFill('late',.001,3600000)).toThrow();
});
it('uses only completed4h regime/amplitude and structural lows preceding the pullback',()=>{
 const h=Array.from({length:1008},(_,i)=>({timestamp:i*3600000,open:100+i*.05,high:101+i*.05,low:99+i*.05,close:100+i*.05,volume:100}));
 const four=aggregateFourHours(h),a=swingChecks(h.slice(0,1000),four)!;expect(a.checks.regime).toBe(true);for(let i=250;i<four.length;i++)four[i]!.close=1;expect(swingChecks(h.slice(0,1000),four)).toEqual(a);expect(swingChecks(h.slice(0,999),four)).toBeNull();
 h[999]!.low=1;expect(swingChecks(h.slice(0,1000),four)!.checks.structure).toBe(false);
});
function fixture(){
 const time=Date.parse(p.window.evaluationStartUtc),start=time-1000*3600000,n=1000+p.window.days*24,h=Array.from({length:n},(_,i)=>({timestamp:start+i*3600000,open:101,high:101.5,low:100.5,close:101,volume:6000}));
 const data:SwingData={window:p.window,instruments:['BTC/USDT','ETH/USDT','SOL/USDT'].map(symbol=>({symbol,hours:h.map(c=>({...c}))}))};
 const signals:SwingSignal[]=[{symbol:'BTC/USDT',decisionTimestamp:time-3600000,entryHour:time,limit:100,stop:98,atr4h:2}];
 const m=Array.from({length:60},(_,i)=>({timestamp:time+i*60000,open:101,high:101.5,low:100.5,close:101,volume:100}));m[0]!.low=99.8;
 const micro:MakerMicro={windows:[{symbol:'BTC/USDT',hour:time,candles:m}],missing:[],publicRulesMatched:true};
 const sync=()=>{const b=data.instruments[0]!.hours[1000]!;b.high=Math.max(...m.map(c=>c.high));b.low=Math.min(...m.map(c=>c.low));b.open=m[0]!.open;b.close=m.at(-1)!.close;b.volume=m.reduce((n,c)=>n+c.volume,0);};sync();
 const budget=2.55,qty=quantizeQuantityDown(budget,100,1e-8).quantity,preview=new SwingV2Position('BTC/USDT',100,98,qty,time,rules,s);preview.buyFill('full',qty,time);
 return {time,data,signals,micro,m,sync,preview};
}
it('does not grant maker target profit for a touch or before the target rests',()=>{
 const f=fixture();f.m[10]!.high=f.preview.target;f.sync();const r=complete(replaySwingV2(f.data,f.signals,f.micro,p,s,p.window));expect(r.closedTrades).toBe(0);
 const g=fixture();g.m[0]!.high=g.preview.target+1;g.sync();const early=complete(replaySwingV2(g.data,g.signals,g.micro,p,s,p.window));expect(early.closedTrades).toBe(0);
});
it('fills a pre-positioned maker target on strict penetration, reconciling cash, commissions and buffer',()=>{
 const f=fixture();f.m[10]!.high=f.preview.target+.3;f.sync();const r=complete(replaySwingV2(f.data,f.signals,f.micro,p,s,p.window));expect(r.closedTrades).toBe(1);expect(r.closedTradeLedger[0]!.reason).toBe('MAKER_TARGET');expect(r.finalEquityUsdt-17).toBeCloseTo(r.realizedPnlUsdt);expect(r.modeledBufferUsdt).toBeGreaterThan(0);expect(r.events.find(e=>e.type==='maker_target_fill').price).toBe(f.preview.target);
});
it('uses taker emergency stop first, including gap, instead of assigning maker fee to an ambiguous target',()=>{
 const f=fixture();f.m[10]={...f.m[10]!,open:97,low:96,high:f.preview.target+1};f.sync();const r=complete(replaySwingV2(f.data,f.signals,f.micro,p,s,p.window));expect(r.closedTradeLedger[0].reason).toBe('STOP_LOSS');expect(r.closedMakerTargets).toBe(0);expect(r.modeledBufferUsdt).toBe(0);expect(r.events.find(e=>e.type==='stop_fill').price).toBeCloseTo(97*(1-exitFriction(s)));
});
it('protects only from the following minute and does not retroactively stop in its trigger minute',()=>{
 const f=fixture(),activation=f.preview.activationPrice;expect(activation).toBeLessThan(f.preview.target);f.m[2]={...f.m[2]!,close:activation+.01,high:activation+.02,low:100.5};
 const clone=new SwingV2Position('BTC/USDT',100,98,f.preview.buy.requestedQuantity,f.time,rules,s);clone.buyFill('a',clone.buy.requestedQuantity,f.time);const floor=clone.protectAtClose(activation+.01)!;
 f.m[3]={...f.m[3]!,open:activation,high:activation+.01,low:floor-.1,close:floor};f.sync();const r=complete(replaySwingV2(f.data,f.signals,f.micro,p,s,p.window));const t=r.closedTradeLedger[0];expect(t.reason).toBe('PROTECTED_STOP');expect(t.exitTimestamp).toBe(f.time+180000);expect(t.netPnlUsdt).toBeGreaterThanOrEqual(.15*t.initialNetRiskUsdt-1e-8);expect(r.events.find(e=>e.type==='protection_updated').effectiveFrom).toBe(f.time+180000);
});
it('requires minute evidence for later stop/target/activation hours instead of fabricating coarse-hour fills',()=>{
 const f=fixture();f.data.instruments[0]!.hours[1001]!.high=f.preview.target+1;const r=replaySwingV2(f.data,f.signals,f.micro,p,s,p.window);expect(r.status).toBe('awaiting_minute_evidence');if(!('needed' in r))throw new Error('Expected missing minute evidence');expect(r.needed).toEqual([{symbol:'BTC/USDT',entryHour:f.time+3600000}]);
 f.micro.windows.push(f.micro.windows[0]!);expect(()=>validateSwingMicro(f.data,f.micro)).toThrow(/Duplicate/);
});
it('keeps pending cash reserved, does not enter a second pair and reports unfilled order expiry',()=>{
 const f=fixture();for(const c of f.m)c.low=100;f.sync();f.signals.push({...f.signals[0]!,symbol:'ETH/USDT'});const r=complete(replaySwingV2(f.data,f.signals,f.micro,p,s,p.window));expect(r.ordersPlaced).toBe(1);expect(r.ordersWithFills).toBe(0);expect(r.finalEquityUsdt).toBe(17);expect(r.events.find(e=>e.type==='buy_order_terminal').reservedUsdt).toBe(0);expect(r.rejected.portfolio_priority).toBe(1);
});
it('does not approve zero activity/adverse collapse or marked-only profits; two complete positive blocks suffice',()=>{
 const b={status:'modeled_replay_complete',closedTrades:30,profitFactorKind:'finite',profitFactor:1.5,expectancyUsdt:.01,netReturnUsdt:1,realizedPnlUsdt:1,maxDrawdownPercent:2,realizedPnlWithoutTop3Usdt:.2,blocks:[{complete:true,netReturnUsdt:.5,realizedPnlUsdt:.5},{complete:true,netReturnUsdt:.6,realizedPnlUsdt:.6},{complete:true,netReturnUsdt:-.1,realizedPnlUsdt:-.1}]};const a={...b,scenario:'maker-target-standard'},c={...b,scenario:'maker-target-adverse'};
 expect(screenSwingV2([a,c]).passed).toBe(true);expect(screenSwingV2([a,{...c,closedTrades:0}]).passed).toBe(false);expect(screenSwingV2([a,{...c,profitFactor:.99}]).passed).toBe(false);expect(screenSwingV2([c,a]).passed).toBe(false);expect(screenSwingV2([{...a,realizedPnlUsdt:-.1},c]).passed).toBe(false);expect(screenSwingV2([{...a,closedTrades:1},c]).passed).toBe(false);
});
