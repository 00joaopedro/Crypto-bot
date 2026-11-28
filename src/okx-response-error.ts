export type OkxFailureCategory='rate_limit'|'temporary'|'minimum'|'precision'|'balance'|'authentication'|'parameters'|'unknown'|'network';
const safeCode=(v:unknown)=>typeof v==='string'&&/^\d{1,8}$/.test(v)?v:null;
/** Keep only numerical codes and a fixed message. Exchange msg may contain account/request secrets. */
export class OkxReadError extends Error {
 readonly code:string|null;readonly sCode:string|null;readonly category:OkxFailureCategory;readonly retryableRead:boolean;readonly exchangeMessagePresent:boolean;
 constructor(input:{code?:unknown;sCode?:unknown;msg?:unknown;httpStatus?:number;network?:boolean},message='OKX read query failed'){
  super(message);this.name='OkxReadError';this.code=safeCode(input.code);this.sCode=safeCode(input.sCode);this.exchangeMessagePresent=typeof input.msg==='string'&&input.msg.length>0;
  const c=this.sCode&&this.sCode!=='0'?this.sCode:this.code;
  this.category=c==='51120'?'minimum':c==='51121'?'precision':['51008','51127','51131'].includes(c??'')?'balance':
   ['50101','50111','50113','50114'].includes(c??'')||input.httpStatus===401||input.httpStatus===403?'authentication':
   ['51000','51001','50014','50015','50016'].includes(c??'')?'parameters':
   ['50011','50040','50061'].includes(c??'')||input.httpStatus===429?'rate_limit':
   ['50001','50004','50013','50026'].includes(c??'')||(input.httpStatus!==undefined&&input.httpStatus>=500)?'temporary':input.network?'network':'unknown';
  this.retryableRead=['rate_limit','temporary','network'].includes(this.category);
 }
 safeDetails(){return {code:this.code,sCode:this.sCode,category:this.category,msg:`OKX read failure: ${this.category}`,exchangeMessagePresent:this.exchangeMessagePresent,retryableRead:this.retryableRead};}
}
export function okxEnvelopeData(raw:unknown,httpStatus=200,message='OKX read query failed'):unknown[]{
 if(!raw||typeof raw!=='object')throw new OkxReadError({httpStatus},message);
 const p=raw as Record<string,unknown>,rows=Array.isArray(p.data)?p.data:[],failed=rows.find(r=>r&&typeof r==='object'&&!Array.isArray(r)&&'sCode'in r&&(r as any).sCode!=='0');
 const sub=failed as Record<string,unknown>|undefined;
 if(httpStatus<200||httpStatus>=300||p.code!=='0'||!Array.isArray(p.data)||failed)throw new OkxReadError({code:p.code,sCode:sub?.sCode??p.sCode??p.subCode,msg:sub?.sMsg??p.msg,httpStatus},message);
 return rows;
}
/** Classifies CCXT read errors without exporting their raw messages. Never authorizes retrying an order submission. */
export function classifyOkxReadError(e:unknown):OkxReadError{
 if(e instanceof OkxReadError)return e;
 const v=e&&typeof e==='object'?e as Record<string,unknown>:{},text=typeof v.message==='string'?v.message:'';
 const code=text.match(/"code"\s*:\s*"(\d+)"/)?.[1],sCode=text.match(/"sCode"\s*:\s*"(\d+)"/)?.[1];
 const name=typeof v.name==='string'?v.name:'';
 return new OkxReadError({code,sCode,msg:text,...(name==='RateLimitExceeded'?{httpStatus:429}:{}),network:['NetworkError','RequestTimeout','ExchangeNotAvailable','TimeoutError','AbortError','TypeError'].includes(name)});
}
