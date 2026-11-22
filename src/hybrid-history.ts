import { z } from 'zod';
import { collectOkxSpotHistory } from './okx-history.js';
import { collectUniverseHistory } from './universe-history.js';
import { hybridPlanSchema } from './hybrid-research-signals.js';
import { validateHybridInputs,type HybridInstrument } from './hybrid-research-replay.js';
import { semanticHash } from './cost-experiments.js';

export const hybridCollectionSchema=z.object({
 protocol:z.literal('hybrid-public-collection-v1'),planSha256:z.string().regex(/^[a-f0-9]{64}$/),
 endExclusiveUtc:z.iso.datetime(),days:z.literal(30),marketData:z.literal('OKX_public_spot'),
 minimumNotionalPolicy:z.literal('unknown_not_enforced_research_limitation'),
}).strict();
export function hybridCollectionWindow(raw:unknown,rawPlan:unknown,now=Date.now()){
 const study=hybridCollectionSchema.parse(raw),plan=hybridPlanSchema.parse(rawPlan),end=Date.parse(study.endExclusiveUtc);
 if(semanticHash(plan)!==study.planSha256||end%3600000||end>now)throw new Error('Invalid frozen hybrid collection identity/window');
 return {study,plan,end,start:end-(study.days*96+plan.warmup15m)*900000,evaluationStart:end-study.days*86400000};
}
export function hybridInstrumentRules(row:Record<string,unknown>,symbol:string,start:number){
 const minimumQuantity=Number(row.minSz),quantityStep=Number(row.lotSz),priceTick=Number(row.tickSz),listTime=Number(row.listTime);
 if(row.instId!==symbol.replace('/','-')||row.instType!=='SPOT'||row.quoteCcy!=='USDT'||row.state!=='live'||![minimumQuantity,quantityStep,priceTick].every(v=>Number.isFinite(v)&&v>0))throw new Error('Unconfirmed public Spot instrument rules');
 if(!Number.isFinite(listTime)||listTime>start)throw new Error('Instrument listed after study warmup start');
 // Public minSz is a base-quantity minimum, not proof of a quote-notional minimum.
 return {constraints:{minimumQuantity,quantityStep,minimumNotionalUsdt:0},terms:{minimumQuantity,quantityStep,priceTick,listTime,minimumNotionalUsdt:null,minimumNotionalStatus:'unknown_not_enforced_in_research'}};
}
export async function collectHybridPair(fetchPage:Parameters<typeof collectOkxSpotHistory>[0],symbol:string,constraints:HybridInstrument['constraints'],start:number,end:number,now:number){
 const instId=symbol.replace('/','-');
 const quarter=await collectUniverseHistory(fetchPage,instId,start,end,now);
 const candles1h=await collectOkxSpotHistory(fetchPage,instId,start,end,now,'1H');
 return {symbol,constraints,candles15m:quarter.candles,candles1h,quoteVolumesUsdt:quarter.quoteVolumesUsdt};
}
export function validateHybridCollection(instruments:HybridInstrument[],raw:unknown,rawPlan:unknown,now=Date.now()){
 const window=hybridCollectionWindow(raw,rawPlan,now);validateHybridInputs(instruments,window.plan);
 for(const d of instruments)if(d.candles15m.length!==3880||d.candles1h.length!==970||d.candles15m[0]!.timestamp!==window.start||d.candles1h[0]!.timestamp!==window.start||d.candles15m.at(-1)!.timestamp+900000!==window.end||d.candles1h.at(-1)!.timestamp+3600000!==window.end)throw new Error('Incomplete frozen 30-day hybrid history');
 return window;
}

export function verifyHybridSnapshot(data:{asOfUtc:string;instruments:HybridInstrument[]},source:{complete:boolean;datasetSha256:string;collectionSha256:string;planSha256:string;assets:Array<{symbol:string;sha256:string;candles15m:number;candles1h:number}>},rawStudy:unknown,rawPlan:unknown){
 const w=validateHybridCollection(data.instruments,rawStudy,rawPlan);
 const assets=data.instruments.map(d=>({symbol:d.symbol,sha256:semanticHash(d),candles15m:d.candles15m.length,candles1h:d.candles1h.length}));
 if(data.asOfUtc!==w.study.endExclusiveUtc||!source.complete||source.datasetSha256!==semanticHash(data)||source.collectionSha256!==semanticHash(w.study)||source.planSha256!==semanticHash(w.plan)||JSON.stringify(source.assets)!==JSON.stringify(assets))throw new Error('Frozen hybrid snapshot hash/identity mismatch');
 return w;
}
