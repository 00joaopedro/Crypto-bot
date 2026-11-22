import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function controls(){
 const elements=new Map<string,any>();
 const element=(id:string)=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,textContent:'',lastChild:{textContent:''},classList:{toggle(){}},addEventListener(){}});return elements.get(id)};
 const fetch=vi.fn();
 const context=createContext({document:{getElementById:element},localStorage:{getItem:()=>null},fetch,AbortController,setTimeout:()=>1,clearTimeout(){},URLSearchParams,Intl});
 runInContext(source.slice(0,source.indexOf("$('logout')")),context);
 runInContext(source.slice(source.indexOf('const controlReasons='),source.indexOf("$('start-demo-cycle')")),context);
 runInContext(source.slice(source.indexOf('function renderControl(){'),source.indexOf('function setMetric(')),context);
 runInContext('load=async()=>{};state={paused:true,pauseReason:null,autoResume:null};',context);
 return {element,fetch,run:(code:string)=>runInContext(code,context)};
}
const response=(body:unknown)=>({ok:true,status:200,json:async()=>body});
describe('dashboard control intent',()=>{
 it('keeps a pending pause disabled across renders, ignores duplicate clicks and clears old blocker details on success',async()=>{
  const c=controls();c.run("state.paused=false;state.controlJob={status:'blocked',reason:'demo_bot_risk_attribution_unconfirmed'}");
  let release!:(value:unknown)=>void;c.fetch.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}));
  const command=c.run('sendControl(true)');c.run('renderControl()');
  expect(c.element('toggle-bot').disabled).toBe(true);expect(c.element('toggle-bot').textContent).toBe('Pausando…');
  await c.run('sendControl(true)');expect(c.fetch).toHaveBeenCalledTimes(1);
  release(response({paused:true,status:'completed'}));await command;
  expect(c.run('state.controlJob')).toBeNull();expect(c.element('toggle-bot').disabled).toBe(false);
  expect(c.element('control-message').textContent).toContain('Pausa mantida por você');
 });
 it('shows resume phase and refuses to show Online while safety remains pending',()=>{
  const c=controls();c.run("controlPending=true;state.controlJob={status:'pending',phase:'checking_accounting',startedAt:Date.now()-2000};renderControl()");
  expect(c.element('control-message').textContent).toContain('Conferindo saldos, execuções e risco');
  expect(c.element('connection').lastChild.textContent).toBe(' Pausado');expect(c.element('keep-paused').hidden).toBe(false);
 });
 it('shows specific attribution once instead of repeating the generic reason',()=>{
  const c=controls();c.run("state.pauseReason='demo_bot_risk_attribution_unconfirmed';state.autoResume={enabled:true,eligibleAt:1,checkedAt:Date.now(),reason:state.pauseReason,attributionReason:'position_balance_missing',balanceEvidence:{asset:'SOL',expected:0.5,actual:null}};renderControl()");
  const message=c.element('control-message').textContent;
  expect(message.match(/Não foi possível conciliar/g)).toHaveLength(1);expect(message).toContain('SOL: esperado 0.5; lido não informado');
 });
 it('never lets a stale control poll undo a later pause intent',async()=>{
  const c=controls();let release!:(value:unknown)=>void;c.fetch.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}));
  const poll=c.run('pollControl()');c.run('++controlVersion;state.paused=true');release(response({paused:false,job:{status:'completed'}}));await poll;
  expect(c.run('state.paused')).toBe(true);
 });
});
