import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {breakoutV2Checks,scanBreakoutV2} from '../src/breakout-v2-signals.js';
import {BreakoutV2Position} from '../src/breakout-v2-position.js';
import {replayBreakoutV2,screenBreakoutV2} from '../src/breakout-v2-replay.js';
import {SwingV2Position,exitFriction} from '../src/swing-v2-ledger.js';
import {quantizeQuantityDown} from '../src/decimal-quantity.js';
import {aggregateFourHours} from '../src/trend-horizon.js';
import {averageTrueRange} from '../src/indicators.js';
import type {SwingData,SwingSignal} from '../src/swing-v2-signals.js';
import type {MakerMicro} from '../src/maker-pullback.js';
const p=JSON.parse(readFileSync(new URL('../examples/breakout-v2.plan.json',import.meta.url),'utf8')),s=p.scenarios[0],rules=p.rules['BTC/USDT'];
function position(costs=s){const q=new BreakoutV2Position('BTC/USDT',100,98,.02,0,rules,costs);q.buyFill('a',.02,0);return q;}
function complete(r:ReturnType<typeof replayBreakoutV2>){if(!('closedTrades' in r))throw Error('Unexpected missing minutes');return r;}
it('uses the eight PRE-breakout candles and prior ATR/volume, requiring displacement and volume',()=>{
 const h=Array.from({length:60},(_,i)=>({timestamp:i*14400000,open:100,close:100,high:i<51?110:101,low:i<51?90:99,volume:100}));h[59]={...h[59]!,close:106,high:107,volume:150};const a=breakoutV2Checks(h)!;
 expect(Object.values(a.checks).every(Boolean)).toBe(true);expect(a.top).toBe(101);h[59]!.high=200;expect(breakoutV2Checks(h)!.top).toBe(101);h[59]!.volume=129;expect(breakoutV2Checks(h)!.checks.volume).toBe(false);h[59]!.close=101.01;expect(breakoutV2Checks(h)!.checks.body).toBe(false);
});
it('retains H1 defaults while H2 has4h validity and3R NET target in both cost scenarios',()=>{
 expect(new SwingV2Position('BTC/USDT',100,98,.02,0,rules,s).buy.expiresAt).toBe(3600000);
 for(const c of p.scenarios){const q=position(c);expect(q.buy.expiresAt).toBe(14400000);q.postTarget(101,60000);const before=q.initialRisk;q.sellFill('tp',q.remaining,q.target,'maker');expect(q.netPnl/before).toBeGreaterThanOrEqual(3-1e-10);}
});
it('activates1.2R protection and2R trailing below the3R net maker target after fees',()=>{
 for(const c of p.scenarios){const q=position(c),at1=q.activationPrice;expect(at1).toBeLessThan(q.target);expect(q.stageAtMinuteClose(at1-.001).protection).toBeNull();const stage=q.stageAtMinuteClose(at1+.01);expect(stage.protection).not.toBeNull();expect(stage.armed).toBe(false);
 const net=q.remaining*q.stop*(1-c.takerRate)*(1-exitFriction(c))-q.buy.spentUsdt;expect(net).toBeGreaterThanOrEqual(.2*q.initialRisk-1e-9);const at2=q.activationPrice;expect(at2).toBeGreaterThan(at1);expect(at2).toBeLessThan(q.target);expect(q.stageAtMinuteClose(at2+.01).armed).toBe(true);expect(q.activationPrice).toBe(Infinity);}
});
it('raises trailing only after arming, never lowers it and skips proposals already beyond close',()=>{
 const q=position();expect(q.updateClosedFourHour(106,2,105)).toBeNull();q.stageAtMinuteClose(q.target-.2);expect(q.trailingArmed).toBe(true);const a=q.updateClosedFourHour(107,2,106)!;expect(a).toBeGreaterThan(100);expect(a).toBeLessThan(106);expect(q.updateClosedFourHour(106,4,106)).toBeNull();expect(q.stop).toBe(a);expect(q.updateClosedFourHour(120,1,106)).toBeNull();expect(q.stop).toBe(a);
});
it('keeps partial entry idempotent and cancels remainder before net protection',()=>{
 const q=new BreakoutV2Position('BTC/USDT',100,98,.04,0,rules,s);q.buyFill('a',.02,60000);expect(q.buyFill('a',.02,60000)).toBe(false);expect(q.buy.reservedUsdt).toBe(2);q.stageAtMinuteClose(q.activationPrice+.01);expect(q.buy.reservedUsdt).toBe(0);expect(q.buy.status).toBe('canceled');expect(()=>q.buyFill('late',.01,120000)).toThrow();
});
function fixture(){const time=Date.parse(p.window.evaluationStartUtc),start=time-1000*3600000,h=Array.from({length:5320},(_,i)=>({timestamp:start+i*3600000,open:101,close:101,high:101.5,low:100.5,volume:6000}));const data:SwingData={window:p.window,instruments:['BTC/USDT','ETH/USDT','SOL/USDT'].map(symbol=>({symbol,hours:h.map(c=>({...c}))}))};const signals:SwingSignal[]=[{symbol:'BTC/USDT',decisionTimestamp:time-14400000,entryHour:time,limit:100,stop:98,atr4h:2}];
 const micro:MakerMicro={windows:[],missing:[],publicRulesMatched:true};const addHour=(k:number)=>{const candles=Array.from({length:60},(_,i)=>({timestamp:time+k*3600000+i*60000,open:101,close:101,high:101.5,low:100.5,volume:100}));micro.windows.push({symbol:'BTC/USDT',hour:time+k*3600000,candles});return candles;};for(let k=0;k<4;k++)addHour(k);
 const sync=()=>{for(const w of micro.windows){const c=w.candles,b=data.instruments[0]!.hours.find(h=>h.timestamp===w.hour)!;Object.assign(b,{open:c[0]!.open,close:c.at(-1)!.close,high:Math.max(...c.map(x=>x.high)),low:Math.min(...c.map(x=>x.low)),volume:c.reduce((a,x)=>a+x.volume,0)});}};
 const qty=quantizeQuantityDown(2.55,100,rules.quantityStep).quantity,preview=new BreakoutV2Position('BTC/USDT',100,98,qty,time,rules,s);preview.buyFill('full',qty,time);return{time,data,signals,micro,sync,addHour,preview};}
it('fills a retest in the THIRD hour, preserving pending cash and shared portfolio ownership',()=>{
 const f=fixture();f.micro.windows[2]!.candles[5]!.low=99.8;f.sync();f.signals.push({...f.signals[0]!,entryHour:f.time+3600000,symbol:'ETH/USDT'});const r=complete(replayBreakoutV2(f.data,f.signals,f.micro,p,s,p.window));expect(r.ordersPlaced).toBe(1);expect(r.ordersWithFills).toBe(1);expect(r.events.find(e=>e.type==='buy_fill').timestamp).toBe(f.time+2*3600000+5*60000);expect(r.rejected.position_occupied).toBe(1);expect(r.openPosition?.symbol).toBe('BTC/USDT');
});
it('expires at exactly4hours, releases reserve and never uses a later penetration as a fill',()=>{
 const f=fixture();f.data.instruments[0]!.hours[1004]!.low=99;const r=complete(replayBreakoutV2(f.data,f.signals,f.micro,p,s,p.window));expect(r.ordersWithFills).toBe(0);expect(r.finalEquityUsdt).toBe(17);expect(r.events.find(e=>e.type==='buy_order_terminal').reservedUsdt).toBe(0);expect(r.orders[0].expiresAt).toBe(f.time+14400000);
});
it('demands later pending-hour evidence rather than shortening the order to the first hour',()=>{
 const f=fixture();f.micro.windows=f.micro.windows.slice(0,1);const r=replayBreakoutV2(f.data,f.signals,f.micro,p,s,p.window);expect(r.status).toBe('awaiting_minute_evidence');if(!('needed'in r))throw Error('Expected missing');expect(r.needed[0]!.entryHour).toBe(f.time+3600000);
});
it('never awards a maker target for touch or the new-fill minute',()=>{
 const f=fixture();f.micro.windows[0]!.candles[0]!.low=99.8;f.micro.windows[0]!.candles[0]!.high=f.preview.target+1;f.micro.windows[0]!.candles[10]!.high=f.preview.target;f.sync();const r=complete(replayBreakoutV2(f.data,f.signals,f.micro,p,s,p.window));expect(r.closedTrades).toBe(0);expect(r.closedMakerTargets).toBe(0);
});
it('uses emergency taker stop first, including gaps, and keeps actual maker limit economics',()=>{
 const f=fixture();f.micro.windows[0]!.candles[0]!.low=99.8;f.micro.windows[0]!.candles[10]={...f.micro.windows[0]!.candles[10]!,open:97,low:96,high:f.preview.target+1};f.sync();const r=complete(replayBreakoutV2(f.data,f.signals,f.micro,p,s,p.window));expect(r.closedTradeLedger[0].reason).toBe('STOP_LOSS');expect(r.events.find(e=>e.type==='stop_fill').price).toBeCloseTo(97*(1-exitFriction(s)));expect(r.closedMakerTargets).toBe(0);
 const g=fixture();g.micro.windows[0]!.candles[0]!.low=99.8;g.micro.windows[0]!.candles[10]!.high=g.preview.target+.2;g.sync();const win=complete(replayBreakoutV2(g.data,g.signals,g.micro,p,s,p.window));expect(win.closedMakerTargets).toBe(1);expect(win.closedTradeLedger[0].netPnlUsdt).toBeGreaterThanOrEqual(3*win.closedTradeLedger[0].initialNetRiskUsdt-1e-10);expect(win.finalEquityUsdt-17).toBeCloseTo(win.realizedPnlUsdt);
});
it('updates trailing from a wholly owned closed4h high and applies it only in the NEXT interval',()=>{
 const f=fixture(),q=f.preview;const at2=(q.buy.spentUsdt+2*q.initialRisk)/(q.remaining*(1-s.takerRate)*(1-exitFriction(s)))+.01;for(let k=4;k<=8;k++)f.addHour(k);
 for(const w of f.micro.windows)for(const c of w.candles)if(c.timestamp>=f.time+120000)Object.assign(c,{open:at2,close:at2,high:at2+.2,low:at2-.1});f.micro.windows[0]!.candles[0]!.low=99.8;f.sync();q.stageAtMinuteClose(at2);const four=aggregateFourHours(f.data.instruments[0]!.hours).filter(c=>c.timestamp+14400000<=f.time+8*3600000),floor=q.updateClosedFourHour(at2+.2,averageTrueRange(four,14),at2)!;expect(floor).toBeLessThan(at2-.1);
 f.micro.windows[8]!.candles[0]!.low=floor-.1;f.sync();const r=complete(replayBreakoutV2(f.data,f.signals,f.micro,p,s,p.window)),updates=r.events.filter(e=>e.type==='trailing_updated');expect(updates).toHaveLength(1);expect(updates[0].effectiveFrom).toBe(f.time+8*3600000);expect(r.closedTradeLedger[0].reason).toBe('TRAILING_STOP');expect(r.closedTradeLedger[0].exitTimestamp).toBe(f.time+8*3600000);expect(r.closedTradeLedger[0].netPnlUsdt).toBeGreaterThan(0);
});
it('does not approve insufficient sample, undefined PF or a collapsed adverse scenario',()=>{
 const a={scenario:'maker-target-standard',status:'modeled_replay_complete',closedTrades:1,profitFactorKind:'undefined',profitFactor:null,netReturnUsdt:0,realizedPnlUsdt:0,expectancyUsdt:null,maxDrawdownPercent:0,blocks:[],realizedPnlWithoutTop3Usdt:0};expect(screenBreakoutV2([a,{...a,scenario:'maker-target-adverse'}]).passed).toBe(false);
});

it('scans only closed4h, quantizes the retest and chooses the lower technical stop without future influence',()=>{
 const f=fixture(),window={...p.window,days:3,endExclusiveUtc:new Date(f.time+3*86400000).toISOString()},data={...f.data,window,instruments:f.data.instruments.map(d=>({...d,hours:d.hours.slice(0,1072)}))};
 for(const d of data.instruments)for(let j=200;j<=250;j++)for(let k=0;k<4;k++){const h=d.hours[j*4+k]!;Object.assign(h,{open:100,close:j===250&&k===3?106:100,high:j<242?110:j===250&&k===3?107:101,low:j<242?90:99,volume:j===250?150:100});}
 const a=scanBreakoutV2(data,p,window).signals.filter(s=>s.entryHour===f.time+4*3600000);expect(a).toHaveLength(3);expect(a[0]!.limit).toBe(101.1);expect(a[0]!.stop).toBeLessThan(99.9);
 for(const d of data.instruments)for(let i=1004;i<d.hours.length;i++)d.hours[i]!.high=200;
 const b=scanBreakoutV2(data,p,window).signals.filter(s=>s.entryHour===f.time+4*3600000);expect(b).toEqual(a);
});
