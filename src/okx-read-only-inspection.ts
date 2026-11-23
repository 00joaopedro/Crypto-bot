import { createHmac } from "node:crypto";
import { z } from "zod";
const paths=["/api/v5/account/config","/api/v5/account/balance","/api/v5/account/trade-fee","/api/v5/public/instruments"] as const;
type ReadPath=typeof paths[number];
export type ReadCredentials={apiKey:string;secretKey:string;passphrase:string};
export function createOkxReadOnlyClient(credentials:ReadCredentials,environment:"demo"|"real",transport:typeof fetch=fetch,clock=()=>new Date()){
 if(!Object.values(credentials).every(v=>typeof v==="string"&&v.length>0)||!["demo","real"].includes(environment))throw new Error("Read credentials and explicit environment required");
 return Object.freeze({environment,async get(path:ReadPath,query:Record<string,string>={}):Promise<unknown[]>{
  if(!paths.includes(path))throw new Error("Read endpoint not allowed");
  const params=new URLSearchParams(query),requestPath=path+(params.size?'?'+params.toString():'');
  const headers:Record<string,string>={"Content-Type":"application/json"};
  if(environment==="demo")headers['x-simulated-trading']='1';
  if(path!=="/api/v5/public/instruments"){
   const timestamp=clock().toISOString();
   headers['OK-ACCESS-KEY']=credentials.apiKey;headers['OK-ACCESS-PASSPHRASE']=credentials.passphrase;headers['OK-ACCESS-TIMESTAMP']=timestamp;
   headers['OK-ACCESS-SIGN']=createHmac('sha256',credentials.secretKey).update(timestamp+'GET'+requestPath).digest('base64');
  }
  try{
   const response=await transport('https://openapi.okx.com'+requestPath,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error('failed');
   const envelope=z.object({code:z.literal('0'),data:z.array(z.unknown())}).parse(await response.json());return envelope.data;
  }catch{throw new Error('OKX read query failed');}
 }});
}
const numeric=(value:unknown):number|null=>typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):null;
const nonnegative=(value:unknown)=>{const n=numeric(value);return n!==null&&n>=0?n:null;};
const envelopeRecord=(value:unknown)=>z.record(z.string(),z.unknown()).parse(value);
/** Allowlisted projection only: no credentials, uid, account label or complete API payload is returned. */
export async function inspectOkxReadOnly(client:ReturnType<typeof createOkxReadOnlyClient>,environment:"demo"|"real",symbols:string[],clock=()=>new Date(),controls?:{maximumSymbols:20;beforeFee:()=>Promise<void>}){
 if(client.environment!==environment)throw new Error("Read snapshot environment mismatch");
 const maximumSymbols=controls?.maximumSymbols===20?20:3;
 if(!symbols.length||symbols.length>maximumSymbols||new Set(symbols).size!==symbols.length||symbols.some(s=>!/^[-A-Z0-9._]+\/USDT$/.test(s)))throw new Error(maximumSymbols===20?'One to twenty distinct USDT pairs required':'One to three distinct USDT pairs required');
 const configRows=await client.get('/api/v5/account/config');if(configRows.length!==1)throw new Error('Account configuration unconfirmed');
 const config=envelopeRecord(configRows[0]),permissions=String(config.perm??'').split(',').map(s=>s.trim());
 if(!permissions.includes('read_only')||permissions.some(p=>p!=='read_only'))throw new Error('A dedicated Read-only API key is required');
 const balanceRows=await client.get('/api/v5/account/balance',{ccy:'USDT'});
 const instruments=await client.get('/api/v5/public/instruments',{instType:'SPOT'});
 const details=balanceRows.length===1?z.object({details:z.array(z.unknown())}).parse(balanceRows[0]).details.map(envelopeRecord).filter(r=>r.ccy==='USDT'):[];
 const b=details.length===1?details[0]:undefined;
 const available=nonnegative(b?.availBal),cash=nonnegative(b?.cashBal),liability=nonnegative(b?.liab);
 const confirmed=String(config.acctLv)==='1'&&config.enableSpotBorrow===false&&config.autoLoan===false&&liability===0&&available!==null&&cash!==null;
 const cashUpperBound=available!==null&&cash!==null?Math.min(17,available,cash):null;
 const terms=[];
 for(const symbol of symbols){
  const instId=symbol.replace('/','-');
  const rows=instruments.map(envelopeRecord).filter(r=>r.instId===instId&&r.instType==='SPOT'&&r.quoteCcy==='USDT'&&r.state==='live');
  const market=rows.length===1?rows[0]:undefined,min=numeric(market?.minSz),step=numeric(market?.lotSz),tick=numeric(market?.tickSz);
  const instrumentConfirmed=min!==null&&min>0&&step!==null&&step>0&&tick!==null&&tick>0;
  let takerCostRate:number|null=null,feeStatus='unavailable';
  if(instrumentConfirmed)try{
   await controls?.beforeFee();
   const feeRows=await client.get('/api/v5/account/trade-fee',{instType:'SPOT',instId});
   const f=feeRows.length===1?envelopeRecord(feeRows[0]):null;
   let signed:number|null=null;
   if(f&&(!f.instId||f.instId===instId)&&(!f.instType||f.instType==='SPOT')){
    if(f.feeGroup!==undefined&&(!Array.isArray(f.feeGroup)||f.feeGroup.length)){
     const groupId=typeof market?.groupId==='string'?market.groupId:null;
     const groups=(Array.isArray(f.feeGroup)?f.feeGroup:[]).map(envelopeRecord).filter(g=>groupId?g.groupId===groupId:f.feeGroup instanceof Array&&f.feeGroup.length===1);
     if(groups.length===1)signed=numeric(groups[0]!.taker);
    }else signed=numeric(f.taker);
   }
   // OKX API negative = charge, positive = rebate. Never assume rebates or use abs() blindly.
   if(signed!==null&&signed<=0&&signed>-.1){takerCostRate=signed===0?0:-signed;feeStatus='account_pair_quote';}
   else if(signed!==null&&signed>0)feeStatus='rebate_not_modeled';
  }catch{feeStatus='query_failed';}
  terms.push({symbol,instrumentStatus:instrumentConfirmed?'live_spot_rules_observed':'unconfirmed',minimumQuantity:instrumentConfirmed?min:null,quantityStep:instrumentConfirmed?step:null,priceTick:instrumentConfirmed?tick:null,minimumNotionalUsdt:null,feeStatus,takerFeeRate:takerCostRate});
 }
 return {status:'read_only_account_terms_snapshot',environment,capturedAtUtc:clock().toISOString(),declaredBudgetUsdt:17,entryFeeCurrency:config.feeType==='0'?'base':config.feeType==='1'?'quote':null,
  balance:{currency:'USDT',availableUsdt:available,cashUsdt:cash,liabilityUsdt:liability,usableCashStatus:confirmed?'spot_cash_observed':'requires_account_review',withinDeclaredBudgetUsdt:cashUpperBound},terms,
  ordersSent:0,transfersSent:0,configurationChanged:false,realMoneyApproved:false,
  limitations:['Read-only account observations, not fills, strategy approval or capital allocation. No credentials/account IDs/raw API payloads exported.',
   'Demo and real snapshots are distinct. Only an explicit environment is queried; no fallback to another account or estimated fees.',
   'withinDeclaredBudgetUsdt is an upper bound capped at the planned 17 USDT. Unknown/margin/borrow conditions require review; unavailable values are not zero.',
   'minSz/lotSz/tickSz are observed; missing minimum notional remains null rather than assumed zero. Current rules, liquidity and fee exceptions may require additional review.',
   'OKX notes zero-fee exceptions may not be reflected in API rates. Quotes are not historical fills, guarantees of future costs or permission to weaken the frozen reference.']};
}
