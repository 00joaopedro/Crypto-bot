import { HYBRID_WATCHLIST } from './hybrid-research-signals.js';
import { okxEnvelopeData,classifyOkxReadError } from './okx-response-error.js';
export const OKX_CANDLE_WS='wss://ws.okx.com/ws/v5/business';
export type CandleBar='15m'|'1H';
type WireRow=string[];
export interface CandleSocket {readyState:number;send(data:string):void;close():void;addEventListener(type:string,listener:(event:any)=>void):void;}
const duration=(bar:CandleBar)=>bar==='15m'?900000:3600000;
/** Closed-bar cache only. Gaps always fall back to REST; no interpolation or changed portfolio universe. */
export class OkxCandleStream{
 private socket:CandleSocket|null=null;private timer:ReturnType<typeof setInterval>|undefined;private stopped=true;private disabled=false;
 private received=0;private opened=0;private pingAt:number|null=null;private reconnectAt=0;private failures=0;private fault:Error|null=null;
 private cache=new Map<string,Map<number,WireRow>>();private acknowledgements=new Set<string>();
 private lastWsClosedBar:number|null=null;
 private counters={connections:0,confirmedRows:0,duplicates:0,openRowsIgnored:0,futureRowsIgnored:0,restFallbacks:0,cachePages:0,invalidMessages:0};
 constructor(private readonly symbols:readonly string[],private readonly options:{clock?:()=>number;socketFactory?:(url:string)=>CandleSocket;emit?:(event:Record<string,unknown>)=>void}={}){
  if(!symbols.length||symbols.length>20||new Set(symbols).size!==symbols.length||symbols.some(s=>!HYBRID_WATCHLIST.includes(s)))throw new Error('Frozen Spot watchlist subset required');
 }
 private now(){return (this.options.clock??Date.now)();}
 private key(instId:string,bar:CandleBar){return instId+'/'+bar;}
 private allowed(instId:string,bar:unknown):bar is CandleBar{return (bar==='15m'||bar==='1H')&&this.symbols.some(s=>s.replace('/','-')===instId);}
 start(){if(!this.stopped)return;this.stopped=false;this.connect();this.timer=setInterval(()=>this.tick(),1000);this.timer.unref();}
 stop(){this.stopped=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;const s=this.socket;this.socket=null;try{s?.close();}catch{}}
 private disconnect(reason:string,permanent=false){
  const s=this.socket;this.socket=null;this.acknowledgements.clear();this.pingAt=null;this.disabled ||= permanent;
  this.reconnectAt=this.now()+Math.min(30000,1000*2**Math.min(this.failures++,5));
  try{s?.close();}catch{}this.options.emit?.({event:'market_ws_degraded',reason,restFallback:true});
 }
 private connect(){
  if(this.stopped||this.disabled||this.fault)return;
  this.opened=this.now();this.received=this.now();this.counters.connections++;
  try{
   const s=(this.options.socketFactory??(url=>new WebSocket(url)))(OKX_CANDLE_WS);this.socket=s;
   s.addEventListener('open',()=>{if(this.socket!==s||this.stopped){try{s.close();}catch{}return;}
    this.received=this.now();try{s.send(JSON.stringify({op:'subscribe',args:this.symbols.flatMap(symbol=>['candle15m','candle1H'].map(channel=>({channel,instId:symbol.replace('/','-')})))}));}catch{this.disconnect('subscription_send_failed');}
   });
   s.addEventListener('message',(e:any)=>{if(this.socket!==s||this.stopped)return;try{this.message(e.data);}catch{this.fault=new Error('Conflicting or invalid confirmed market candle');this.disconnect('candle_integrity_failure',true);}});
   s.addEventListener('close',()=>{if(this.socket===s&&!this.stopped)this.disconnect('connection_closed');});
   s.addEventListener('error',()=>{if(this.socket===s&&!this.stopped)this.disconnect('connection_error');});
  }catch{this.disconnect('connection_failed');}
 }
 tick(){
  if(this.stopped||this.fault||this.disabled)return;
  if(!this.socket){if(this.now()>=this.reconnectAt)this.connect();return;}
  if(this.socket.readyState!==1){if(this.now()-this.opened>=20000)this.disconnect('connect_timeout');return;}
  if(this.acknowledgements.size===this.symbols.length*2&&this.now()-this.opened>=60000)this.failures=0;
  if(this.pingAt!==null){if(this.now()-this.pingAt>=20000)this.disconnect('pong_timeout');}
  else if(this.now()-this.received>=20000){try{this.socket.send('ping');this.pingAt=this.now();}catch{this.disconnect('ping_failed');}}
 }
 private message(data:unknown){
  this.received=this.now();if(data==='pong'){this.pingAt=null;return;}
  if(typeof data!=='string'||data.length>2_000_000){this.counters.invalidMessages++;return;}
  let p:any;try{p=JSON.parse(data);}catch{this.counters.invalidMessages++;return;}
  if(p?.event==='error'){const error=classifyOkxReadError(new Error(JSON.stringify({code:p.code})));this.options.emit?.({event:'market_ws_api_error',...error.safeDetails()});this.disconnect('subscription_error',!error.retryableRead);return;}
  if(p?.event==='notice'&&p.code==='64008'){this.disconnect('service_upgrade');return;}
  const bar=p?.arg?.channel==='candle15m'?'15m':p?.arg?.channel==='candle1H'?'1H':null,instId=p?.arg?.instId;
  if(typeof instId!=='string'||!this.allowed(instId,bar))return;
  if(p.event==='subscribe'){this.acknowledgements.add(this.key(instId,bar));return;}
  if(!Array.isArray(p.data)){this.counters.invalidMessages++;return;}
  if(!this.acknowledgements.has(this.key(instId,bar)))return;
  for(const row of p.data)this.insert(instId,bar,row,'ws');
 }
 private insert(instId:string,bar:CandleBar,raw:unknown,source:'ws'|'rest'){
  if(!Array.isArray(raw)||raw.length<9)throw new Error('Invalid candle');
  if(raw[8]==='0'){if(source==='ws')this.counters.openRowsIgnored++;return;}
  if(raw[8]!=='1')throw new Error('Invalid confirmation');
  const values=raw.slice(0,8).map(v=>typeof v==='string'&&v.trim()!==''?Number(v):NaN);
  const [ts,o,h,l,c,v,vc,q]=values as [number,number,number,number,number,number,number,number];
  if(!values.every(Number.isFinite)||!Number.isSafeInteger(ts)||ts<0||ts%duration(bar)||Math.min(o,l,c)<=0||h<Math.max(o,c)||l>Math.min(o,c)||Math.min(v,vc,q)<0)throw new Error('Invalid candle values');
  if(ts+duration(bar)>this.now()){this.counters.futureRowsIgnored++;return;}
  const row=[...values.map(String),'1'],key=this.key(instId,bar),bucket=this.cache.get(key)??new Map<number,WireRow>();this.cache.set(key,bucket);
  const old=bucket.get(ts);
  if(old){if([0,1,2,3,4,5,7,8].some(i=>old[i]!==row[i])){this.fault=new Error('Conflicting confirmed market candle');throw this.fault;}if(source==='ws'){this.counters.duplicates++;this.lastWsClosedBar=Math.max(this.lastWsClosedBar??0,ts);}return;}
  bucket.set(ts,row);if(source==='ws'){this.counters.confirmedRows++;this.lastWsClosedBar=Math.max(this.lastWsClosedBar??0,ts);}
  if(bucket.size>400){const oldest=Math.min(...bucket.keys());bucket.delete(oldest);}
 }
 pageBefore(instId:string,bar:CandleBar,after:number,limit:number):WireRow[]|null{
  if(this.fault)throw this.fault;
  if(!this.allowed(instId,bar)||!Number.isSafeInteger(after)||after%duration(bar)||!Number.isSafeInteger(limit)||limit<1||limit>300)throw new Error('Invalid market page request');
  const bucket=this.cache.get(this.key(instId,bar)),rows:WireRow[]=[];
  for(let ts=after-duration(bar);rows.length<limit;ts-=duration(bar)){const row=bucket?.get(ts);if(!row)break;rows.push([...row]);}
  if(!rows.length){this.counters.restFallbacks++;return null;}this.counters.cachePages++;return rows;
 }
 acceptRestPage(instId:string,bar:CandleBar,raw:unknown){
  if(this.fault)throw this.fault;if(!this.allowed(instId,bar))throw new Error('Unsubscribed market');
  for(const row of okxEnvelopeData(raw,200,'OKX returned an invalid history page'))this.insert(instId,bar,row,'rest');
 }
 summary(){return {transport:'okx_public_business_ws_with_rest_repair',connected:this.socket?.readyState===1,subscriptionsConfirmed:this.acknowledgements.size,expectedSubscriptions:this.symbols.length*2,integrityFault:this.fault!==null,disabled:this.disabled,lastWsClosedBarUtc:this.lastWsClosedBar===null?null:new Date(this.lastWsClosedBar).toISOString(),...this.counters,ordersSent:0};}
}
