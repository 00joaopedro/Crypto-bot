import { createHmac } from 'node:crypto';
import { expect,it } from 'vitest';
import { createOkxReadOnlyClient,inspectOkxReadOnly } from '../src/okx-read-only-inspection.js';
const credentials={apiKey:'PRIVATE_KEY_SENTINEL',secretKey:'PRIVATE_SECRET_SENTINEL',passphrase:'PRIVATE_PASSPHRASE_SENTINEL'},clock=()=>new Date('2026-11-22T21:00:00Z');
function fixture(override:{permissions?:string;balance?:any;config?:any;fee?:string;feeFails?:boolean;feeGroup?:unknown;groupId?:string}={}){
 const calls:Array<{url:string;options:RequestInit}>=[];
 const transport=async(url:any,options:any)=>{
  calls.push({url:String(url),options});const u=new URL(String(url));let data:any[]=[];
  if(u.pathname.endsWith('/config'))data=[{acctLv:'1',enableSpotBorrow:false,autoLoan:false,perm:override.permissions??'read_only',uid:'ACCOUNT_ID_SENTINEL',label:'PRIVATE_LABEL',...override.config}];
  if(u.pathname.endsWith('/balance'))data=[{details:[{ccy:'USDT',availBal:'20',cashBal:'25',liab:'0',...override.balance}]}];
  if(u.pathname.endsWith('/instruments'))data=[{instId:'BTC-USDT',instType:'SPOT',quoteCcy:'USDT',state:'live',minSz:'.00001',lotSz:'.00000001',tickSz:'.1',...(override.groupId?{groupId:override.groupId}:{})}];
  if(u.pathname.endsWith('/trade-fee')){if(override.feeFails)throw new Error(credentials.apiKey);data=[{instType:'SPOT',taker:override.fee??'-.004',uid:'ACCOUNT_ID_SENTINEL',...(override.feeGroup?{feeGroup:override.feeGroup}:{})}];}
  return {ok:true,json:async()=>({code:'0',data})} as Response;
 };
 return {calls,client:createOkxReadOnlyClient(credentials,'demo',transport as typeof fetch,clock),transport};
}
it('uses only whitelisted GETs, exact private signatures, demo routing and no credentials on public requests',async()=>{
 const f=fixture(),r=await inspectOkxReadOnly(f.client,'demo',['BTC/USDT'],clock);
 expect(f.calls).toHaveLength(4);expect(f.calls.every(c=>c.options.method==='GET'&&c.options.redirect==='error')).toBe(true);
 const call=f.calls[0]!,u=new URL(call.url),headers=call.options.headers as Record<string,string>;
 expect(u.origin).toBe('https://openapi.okx.com');expect(headers['x-simulated-trading']).toBe('1');expect(headers['OK-ACCESS-SIGN']).toBe(createHmac('sha256',credentials.secretKey).update(clock().toISOString()+'GET'+u.pathname+u.search).digest('base64'));
 const pub=f.calls.find(c=>c.url.includes('/public/'))!;expect((pub.options.headers as any)['OK-ACCESS-KEY']).toBeUndefined();
 expect(r).toMatchObject({ordersSent:0,transfersSent:0,configurationChanged:false,realMoneyApproved:false});
 expect(JSON.stringify(r)).not.toMatch(/PRIVATE_|ACCOUNT_ID_SENTINEL/);
 await expect(f.client.get('/api/v5/trade/order' as any)).rejects.toThrow(/not allowed/);expect(f.calls).toHaveLength(4);
});
it('caps cash at planned 17, checks available cash and liability, and leaves missing notional minimum unknown',async()=>{
 const f=fixture(),r=await inspectOkxReadOnly(f.client,'demo',['BTC/USDT'],clock);
 expect(r.balance).toMatchObject({usableCashStatus:'spot_cash_observed',withinDeclaredBudgetUsdt:17});expect(r.terms[0]).toMatchObject({takerFeeRate:.004,minimumQuantity:.00001,quantityStep:.00000001,minimumNotionalUsdt:null});
 const lower=fixture({balance:{availBal:'5',cashBal:'4'}});expect((await inspectOkxReadOnly(lower.client,'demo',['BTC/USDT'])).balance.withinDeclaredBudgetUsdt).toBe(4);
});
it('does not mistake missing availability, margin equity or debt for confirmed spendable cash',async()=>{
 for(const overrides of [{balance:{availBal:''}},{balance:{liab:'1'}},{config:{acctLv:'4'}},{config:{enableSpotBorrow:true}}]){
  const f=fixture(overrides),r=await inspectOkxReadOnly(f.client,'demo',['BTC/USDT']);expect(r.balance.usableCashStatus).toBe('requires_account_review');
 }
 const f=fixture({balance:{availBal:''}});expect((await inspectOkxReadOnly(f.client,'demo',['BTC/USDT'])).balance.withinDeclaredBudgetUsdt).toBeNull();
});
it('refuses write-enabled keys before other queries and never exposes request errors/secrets',async()=>{
 const f=fixture({permissions:'read_only,trade'});await expect(inspectOkxReadOnly(f.client,'demo',['BTC/USDT'])).rejects.toThrow(/Read-only/);expect(f.calls).toHaveLength(1);
 const failed=createOkxReadOnlyClient(credentials,'real',(async()=>{throw new Error(credentials.secretKey);}) as any,clock);
 await expect(failed.get('/api/v5/account/config')).rejects.toThrow('OKX read query failed');
});
it('normalizes signed fee charges but refuses rebates or errors as assumed free trading',async()=>{
 const rebate=fixture({fee:'.001'}),r=await inspectOkxReadOnly(rebate.client,'demo',['BTC/USDT']);expect(r.terms[0]).toMatchObject({feeStatus:'rebate_not_modeled',takerFeeRate:null});
 const failed=fixture({feeFails:true}),x=await inspectOkxReadOnly(failed.client,'demo',['BTC/USDT']);expect(x.terms[0]).toMatchObject({feeStatus:'query_failed',takerFeeRate:null});expect(JSON.stringify(x)).not.toContain(credentials.apiKey);
});
it('requires explicit environment, separates real headers and bounds inspection to three pairs',async()=>{
 const f=fixture();const real=createOkxReadOnlyClient(credentials,'real',f.transport as typeof fetch,clock);await real.get('/api/v5/account/config');expect((f.calls[0]!.options.headers as any)['x-simulated-trading']).toBeUndefined();
 expect(()=>createOkxReadOnlyClient(credentials,'other' as any)).toThrow();await expect(inspectOkxReadOnly(f.client,'demo',['BTC/USDT','ETH/USDT','SOL/USDT','ADA/USDT'])).rejects.toThrow(/three/);
});

it('rejects mislabeled Demo/real snapshots before making a request',async()=>{
 const f=fixture();expect(()=>{(f.client as any).environment='real';}).toThrow();await expect(inspectOkxReadOnly(f.client,'real',['BTC/USDT'])).rejects.toThrow(/environment mismatch/);expect(f.calls).toHaveLength(0);
});

it('resolves the current feeGroup for the instrument and preserves unknown ambiguous groups',async()=>{
 const feeGroup=[{groupId:'12',taker:'-.001'},{groupId:'13',taker:'-.002'}];
 const f=fixture({groupId:'12',feeGroup,fee:'-.09',config:{feeType:'1'}}),r=await inspectOkxReadOnly(f.client,'demo',['BTC/USDT']);
 expect(r.entryFeeCurrency).toBe('quote');expect(r.terms[0]!.takerFeeRate).toBe(.001);
 const ambiguous=fixture({feeGroup,fee:'-.09'});expect((await inspectOkxReadOnly(ambiguous.client,'demo',['BTC/USDT'])).terms[0]!.takerFeeRate).toBeNull();
});
it('rejects every extra write permission rather than only Trade and Withdraw',async()=>{
 for(const permission of ['transfer','loan','earn']){const f=fixture({permissions:'read_only,'+permission});await expect(inspectOkxReadOnly(f.client,'demo',['BTC/USDT'])).rejects.toThrow(/dedicated/);expect(f.calls).toHaveLength(1);}
});

it('supports the explicit bounded 20-pair panel mode, pacing each fee query and rejecting a larger list',async()=>{
 const symbols=Array.from({length:20},(_,i)=>'COIN'+i+'/USDT');const calls:string[]=[],client={environment:'real' as const,get:async(path:string)=>{
  calls.push(path);return path.endsWith('/config')?[{perm:'read_only'}]:path.endsWith('/balance')?[{details:[]}]:path.endsWith('/instruments')?symbols.map(symbol=>({instId:symbol.replace('/','-'),instType:'SPOT',quoteCcy:'USDT',state:'live',minSz:'.01',lotSz:'.01',tickSz:'.01'})):[{instType:'SPOT',taker:'-.001'}];
 }};let paced=0;
 const r=await inspectOkxReadOnly(client,'real',symbols,clock,{maximumSymbols:20,beforeFee:async()=>{paced++;}});expect(r.terms).toHaveLength(20);expect(paced).toBe(20);expect(calls).toHaveLength(23);
 await expect(inspectOkxReadOnly(client,'real',[...symbols,'MORE/USDT'],clock,{maximumSymbols:20,beforeFee:async()=>{}})).rejects.toThrow(/twenty/);
});
