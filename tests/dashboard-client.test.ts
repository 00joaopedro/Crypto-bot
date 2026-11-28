import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function client(){
 const elements=new Map<string,any>();
 const element=(id:string)=>{if(!elements.has(id))elements.set(id,{hidden:id==='dashboard',value:'',disabled:false,textContent:'',handlers:{} as Record<string,Function>,addEventListener(name:string,fn:Function){this.handlers[name]=fn;}});return elements.get(id)};
 const fetch=vi.fn();
 const sandbox=createContext({document:{getElementById:element},localStorage:{getItem:()=>null},fetch,AbortController,setTimeout,clearTimeout,URLSearchParams,Intl});
 // Exercise the actual authentication/data functions, without chart or unrelated forms.
 runInContext(source.slice(0,source.indexOf("$('logout')")),sandbox);
 runInContext('render=()=>{};loadHybridReport=async()=>{};renderHybrid=()=>{}',sandbox);
 return {element,fetch,run:(code:string)=>runInContext(code,sandbox)};
}
const response=(status:number,body:unknown)=>({ok:status===200,status,json:async()=>body});
describe('dashboard authentication and loading in browser',()=>{
 it('opens the authenticated dashboard before a slow data request completes, suppressing duplicate submits',async()=>{
  const c=client();let release!:()=>void;
  c.fetch.mockResolvedValueOnce(response(200,{ok:true})).mockResolvedValueOnce(response(200,{authenticated:true})).mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve(response(200,{diagnostics:{}}))}));
  c.element('password').value='secret';
  const first=c.run('submitLogin({preventDefault(){}})');await c.run('submitLogin({preventDefault(){}})');await first;
  expect(c.element('login').hidden).toBe(true);expect(c.element('dashboard').hidden).toBe(false);
  expect(c.element('login-submit').disabled).toBe(false);expect(c.element('password').value).toBe('');
  expect(c.fetch).toHaveBeenCalledTimes(3);expect(c.fetch.mock.calls[2]?.[0]).toContain('fast=1');
  release();await vi.waitFor(()=>expect(c.element('dashboard-feedback').textContent).toBe(''));
 });
 it('keeps the panel open after a network error and ignores an obsolete unauthorized data response',async()=>{
  const c=client();c.run('showAuthenticated()');c.fetch.mockRejectedValueOnce(new Error('network offline'));
  await c.run('load()');expect(c.element('dashboard').hidden).toBe(false);expect(c.element('dashboard-feedback').textContent).toBe('network offline');
  let release!:(v:unknown)=>void;c.fetch.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}));
  const old=c.run('load()');c.run('++authGeneration;++loadSequence;showAuthenticated()');release(response(401,{error:'Não autenticado.'}));await old;
  expect(c.element('dashboard').hidden).toBe(false);expect(c.fetch).toHaveBeenCalledTimes(2);
 });
 it('returns to login only after the independent session check confirms expiry',async()=>{
  const c=client();c.run('showAuthenticated()');c.fetch.mockResolvedValueOnce(response(401,{error:'Não autenticado.'})).mockResolvedValueOnce(response(401,{error:'Não autenticado.'}));
  await c.run('load()');expect(c.element('dashboard').hidden).toBe(true);expect(c.element('login').hidden).toBe(false);
 });
 it('ensures hidden login and controls override authored grid/flex display',()=>{
  expect(readFileSync(new URL('../public/styles.css',import.meta.url),'utf8')).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important\s*\}/);
 });
});
