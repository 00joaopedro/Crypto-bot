import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { semanticHash } from '../src/cost-experiments.js';
import { hybridCollectionWindow,hybridInstrumentRules,collectHybridPair,validateHybridCollection,verifyHybridSnapshot } from '../src/hybrid-history.js';
const plan=JSON.parse(readFileSync(new URL('../examples/hybrid-research.plan.json',import.meta.url),'utf8'));
const study=JSON.parse(readFileSync(new URL('../examples/hybrid-collection.study.json',import.meta.url),'utf8'));
it('freezes a complete 30-day evaluation plus 250 hours of warmup, rejects identity and future changes',()=>{
 const w=hybridCollectionWindow(study,plan,Date.parse(study.endExclusiveUtc));
 expect((w.end-w.evaluationStart)/86400000).toBe(30);expect((w.evaluationStart-w.start)/3600000).toBe(250);
 expect(()=>hybridCollectionWindow({...study,planSha256:'0'.repeat(64)},plan)).toThrow(/identity/);
 expect(()=>hybridCollectionWindow(study,plan,w.end-1)).toThrow(/window/);
 expect(()=>hybridCollectionWindow({...study,endExclusiveUtc:'2026-11-22T22:15:00Z'},plan)).toThrow(/window/);
});
it('keeps unknown quote minimum explicit while enforcing observed Spot minSz and lotSz',()=>{
 const row={instId:'BTC-USDT',instType:'SPOT',quoteCcy:'USDT',state:'live',minSz:'.00001',lotSz:'.00000001',tickSz:'.1',listTime:'0'};
 expect(hybridInstrumentRules(row,'BTC/USDT',1000)).toMatchObject({constraints:{minimumQuantity:.00001,quantityStep:.00000001,minimumNotionalUsdt:0},terms:{minimumNotionalUsdt:null}});
 for(const change of [{instType:'SWAP'},{state:'suspend'},{quoteCcy:'USDC'},{minSz:''},{lotSz:'0'},{listTime:'2000'}])expect(()=>hybridInstrumentRules({...row,...change},'BTC/USDT',1000)).toThrow();
});
it('collects both timeframes and quote volumes, validates exact coverage/cross-timeframe agreement without forward filling',async()=>{
 const w=hybridCollectionWindow(study,plan),row=(t:number,bar:'15m'|'1H')=>[String(t),'100','101','99','100',bar==='1H'?'400':'100','10000',bar==='1H'?'40000':'10000','1'];
 const fetchPage=async(r:{bar:'15m'|'1H';after:string})=>{const duration=r.bar==='1H'?3600000:900000,end=Number(r.after);return {code:'0',data:Array.from({length:Math.min(300,Math.ceil((end-w.start)/duration))},(_,i)=>row(end-(i+1)*duration,r.bar))};};
 const d=await collectHybridPair(fetchPage,'BTC/USDT',{minimumQuantity:.00001,quantityStep:.00001,minimumNotionalUsdt:0},w.start,w.end,w.end);
 expect(d.candles15m).toHaveLength(3880);expect(d.candles1h).toHaveLength(970);expect(d.quoteVolumesUsdt[0]).toBe(10000);
 expect(validateHybridCollection([d],study,plan).start).toBe(w.start);
 const data={asOfUtc:study.endExclusiveUtc,instruments:[d]},source={complete:true,datasetSha256:semanticHash(data),collectionSha256:semanticHash(w.study),planSha256:semanticHash(w.plan),assets:[{symbol:d.symbol,sha256:semanticHash(d),candles15m:3880,candles1h:970}]};
 expect(verifyHybridSnapshot(data,source,study,plan).start).toBe(w.start);
 expect(()=>verifyHybridSnapshot(data,{...source,datasetSha256:'0'.repeat(64)},study,plan)).toThrow(/hash/);
 const shortened={...d,candles15m:d.candles15m.slice(0,-4),quoteVolumesUsdt:d.quoteVolumesUsdt.slice(0,-4),candles1h:d.candles1h.slice(0,-1)};
 expect(()=>validateHybridCollection([shortened],study,plan)).toThrow(/Incomplete/);
 d.candles1h[300]!.high=110;expect(()=>validateHybridCollection([d],study,plan)).toThrow(/disagree/);
});
