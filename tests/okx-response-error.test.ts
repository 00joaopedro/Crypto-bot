import { expect,it } from 'vitest';
import { OkxReadError,okxEnvelopeData,classifyOkxReadError } from '../src/okx-response-error.js';
it('classifies envelope/subrequest failures without exporting raw messages',()=>{
 try{okxEnvelopeData({code:'1',msg:'SECRET_KEY',data:[{sCode:'51121',sMsg:'PASSPHRASE'}]});throw Error('expected');}catch(e){expect(e).toBeInstanceOf(OkxReadError);expect((e as OkxReadError).safeDetails()).toMatchObject({code:'1',sCode:'51121',category:'precision',retryableRead:false});expect(JSON.stringify(e)).not.toMatch(/SECRET|PASSPHRASE/);}
});
it('bounds retry classification to known read failures rather than balances, precision or unknown codes',()=>{
 for(const code of ['50011','50013','50004','50026'])expect(classifyOkxReadError(new Error(JSON.stringify({code}))).retryableRead).toBe(true);
 for(const [code,category]of [['51008','balance'],['51120','minimum'],['50113','authentication'],['99999','unknown']]){const e=classifyOkxReadError(new Error(JSON.stringify({code})));expect(e.category).toBe(category);expect(e.retryableRead).toBe(false);}
});
it('handles HTTP status errors and malformed responses while retaining whitelisted successes',()=>{
 expect(okxEnvelopeData({code:'0',data:[{value:1}]})).toEqual([{value:1}]);
 try{okxEnvelopeData({code:'0',data:[]},429);}catch(e){expect((e as OkxReadError).category).toBe('rate_limit');}
 expect(()=>okxEnvelopeData({code:'0',data:[{sCode:'51008',sMsg:'private'}]})).toThrow('OKX read query failed');expect(()=>okxEnvelopeData(null)).toThrow();
});
it('labels network and timeout failures without leaking request text',()=>{
 const e=classifyOkxReadError(new TypeError('https://secret?key=PRIVATE'));expect(e.category).toBe('network');expect(e.retryableRead).toBe(true);expect(JSON.stringify(e.safeDetails())).not.toContain('PRIVATE');
});
