import { z } from 'zod';
import { hybridPlanSchema } from './hybrid-research-signals.js';
import { comparisonSchema } from './strategy-comparison.js';
import { universeStudySchema } from './universe-comparison.js';
import { positionSizingSchema } from './position-sizing.js';
import { semanticHash } from './cost-experiments.js';
import { scanHybridResearch,replayHybridDecisions,validateHybridInputs } from './hybrid-research-replay.js';

const candle=z.object({timestamp:z.number().int().nonnegative(),open:z.number(),high:z.number(),low:z.number(),close:z.number(),volume:z.number()}).strict();
export const shadowDataSchema=z.object({asOfUtc:z.iso.datetime(),instruments:z.array(z.object({symbol:z.string(),candles15m:z.array(candle),candles1h:z.array(candle),constraints:comparisonSchema.shape.constraints,quoteVolumesUsdt:z.array(z.number()).optional()}).strict()).min(1).max(20)}).strict();
export const shadowProfileSchema=z.object({protocol:z.literal('hybrid-shadow-48h-v1'),durationHours:z.literal(48),environment:z.literal('paper_public_only'),strategyPlanSha256:z.string().regex(/^[a-f0-9]{64}$/),variant:z.enum(['hybrid','trend_pullback','mean_reversion']),costScenario:z.literal('account-conditioned'),allocationMode:z.literal('risk_preserving_ceiling'),riskLimits:positionSizingSchema}).strict();
export function shadowConfiguration(rawProfile:unknown,rawStrategy:unknown,rawReference:unknown){
 const profile=shadowProfileSchema.parse(rawProfile),strategy=hybridPlanSchema.parse(rawStrategy),reference=universeStudySchema.parse(rawReference);
 if(semanticHash(strategy)!==profile.strategyPlanSha256||semanticHash(reference)!==strategy.baselineStudySha256)throw new Error('Shadow frozen configuration identity mismatch');
 const archived=reference.scenarios.find(s=>s.name===profile.costScenario);if(!archived)throw new Error('Shadow cost scenario missing');
 const scenario={...archived,symbolCosts:Object.fromEntries(strategy.watchlist.map(s=>[s,archived.symbolCosts?.[s]??{feeRate:archived.feeRate,slippageRate:archived.slippageRate,spreadRate:archived.spreadRate,entryFeeCurrency:'base' as const}]))};
 return {profile,strategy,reference,scenario,configurationHash:semanticHash({profile,strategy,reference})};
}
export type ShadowConfiguration=ReturnType<typeof shadowConfiguration>;
export type ShadowSnapshot={checkpointSha256:string;schemaVersion:1;codeFingerprint:string;configurationHash:string;startedAtUtc:string;evaluationStart:number;data:z.infer<typeof shadowDataSchema>;dataSha256:string;result:ReturnType<typeof replayHybridDecisions>|null;resultSha256:string;status:'warming'|'observing'|'completed';ordersSent:0;realMoneyApproved:false};
function seal(body:Omit<ShadowSnapshot,'checkpointSha256'>):ShadowSnapshot{return {...body,checkpointSha256:semanticHash(body)};}
function compute(config:ShadowConfiguration,data:z.infer<typeof shadowDataSchema>){
 if(data.instruments[0]!.candles15m.length===config.strategy.warmup15m)return null;
 const decisions=scanHybridResearch(data.instruments,config.strategy,config.profile.variant,config.reference.parameters);
 return replayHybridDecisions(data.instruments,decisions,config.strategy,config.scenario,config.reference.parameters,config.strategy.warmup15m,config.profile.riskLimits);
}
function checkFrame(config:ShadowConfiguration,data:z.infer<typeof shadowDataSchema>,evaluationStart:number,now:number){
 const cutoff=Date.parse(data.asOfUtc),first=evaluationStart-config.strategy.warmup15m*900000,end=evaluationStart+48*3600000;
 if(cutoff>now||cutoff> end||cutoff<evaluationStart||cutoff%900000)throw new Error('Shadow frame cutoff invalid');
 for(const d of data.instruments){
  if(d.candles15m[0]?.timestamp!==first||d.candles15m.at(-1)?.timestamp!==cutoff-900000||d.candles15m.length!==(cutoff-first)/900000||d.candles1h.some(c=>c.timestamp+3600000>cutoff))throw new Error('Shadow frame window invalid');
 }
 validateHybridInputs(data.instruments,config.strategy,true);
}
export function startShadowSession(config:ShadowConfiguration,rawData:unknown,codeFingerprint:string,now=Date.now()):ShadowSnapshot{
 const data=shadowDataSchema.parse(rawData),evaluationStart=Date.parse(data.asOfUtc);
 if(!/^[a-f0-9]{64}$/.test(codeFingerprint)||data.instruments.some(d=>d.candles15m.length!==1000)||now-evaluationStart>900000)throw new Error('Fresh shadow warmup and code fingerprint required');
 checkFrame(config,data,evaluationStart,now);
 return seal({schemaVersion:1,codeFingerprint,configurationHash:config.configurationHash,startedAtUtc:new Date(now).toISOString(),evaluationStart,data,dataSha256:semanticHash(data),result:null,resultSha256:semanticHash(null),status:'warming',ordersSent:0,realMoneyApproved:false});
}
export function advanceShadowSession(config:ShadowConfiguration,previous:ShadowSnapshot,rawData:unknown,codeFingerprint:string,now=Date.now()):ShadowSnapshot{
 const {checkpointSha256,...priorBody}=previous;
 if(checkpointSha256!==semanticHash(priorBody))throw new Error('Shadow checkpoint corruption mismatch');
 if(previous.schemaVersion!==1||previous.codeFingerprint!==codeFingerprint||previous.configurationHash!==config.configurationHash||previous.ordersSent!==0||previous.realMoneyApproved!==false||previous.dataSha256!==semanticHash(previous.data)||previous.resultSha256!==semanticHash(previous.result))throw new Error('Shadow checkpoint identity/corruption mismatch');
 if(!Number.isSafeInteger(previous.evaluationStart)||previous.evaluationStart%900000||!Number.isFinite(Date.parse(previous.startedAtUtc))||now<Date.parse(previous.startedAtUtc))throw new Error('Shadow checkpoint clock invalid');
 checkFrame(config,previous.data,previous.evaluationStart,now);
 // Recompute the prior ledger before accepting more observations; no mutable approval/status flag can promote it.
 if(semanticHash(compute(config,previous.data))!==previous.resultSha256)throw new Error('Shadow restored ledger mismatch');
 const data=shadowDataSchema.parse(rawData);checkFrame(config,data,previous.evaluationStart,now);
 if(Date.parse(data.asOfUtc)<Date.parse(previous.data.asOfUtc)||data.instruments.length!==previous.data.instruments.length)throw new Error('Shadow frame must extend frozen coverage');
 for(let i=0;i<data.instruments.length;i++){
  const next=data.instruments[i]!,old=previous.data.instruments[i]!;
  if(next.symbol!==old.symbol||semanticHash(next.constraints)!==semanticHash(old.constraints)||semanticHash(next.candles15m.slice(0,old.candles15m.length))!==semanticHash(old.candles15m)||semanticHash(next.candles1h.slice(0,old.candles1h.length))!==semanticHash(old.candles1h)||(old.quoteVolumesUsdt===undefined?next.quoteVolumesUsdt!==undefined:next.quoteVolumesUsdt===undefined||semanticHash(next.quoteVolumesUsdt.slice(0,old.candles15m.length))!==semanticHash(old.quoteVolumesUsdt)))throw new Error('Past shadow observations cannot be rewritten');
 }
 const result=compute(config,data),completed=Date.parse(data.asOfUtc)===previous.evaluationStart+48*3600000&&now>=Date.parse(previous.startedAtUtc)+48*3600000;
 return seal({...priorBody,data,dataSha256:semanticHash(data),result,resultSha256:semanticHash(result),status:completed?'completed':result?'observing':'warming'});
}
