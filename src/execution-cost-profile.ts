import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateExecutionSnapshot, tradingTermsSchema } from './execution-fidelity.js';
import { exitPolicySchema } from './exit-policy.js';
import { universeStudySchema, type UniverseStudy } from './universe-comparison.js';

const rate=z.number().finite().nonnegative().lt(.1);
const symbol=z.string().regex(/^[A-Z0-9._-]+\/USDT$/);
export const costPlanSchema=z.object({
  fallbackFeeRate:rate, assumedSlippageRate:rate, assumedSpreadRate:rate,
  stressMultiplier:z.number().finite().gt(1).max(5),sizes:z.array(z.number().int().min(1).max(1000)).min(2).max(5),
}).strict().refine(p=>new Set(p.sizes).size===p.sizes.length,'Unique sizes required');
const terminal=z.object({confirmed:z.literal(true),orderStatus:z.literal('closed'),side:z.enum(['buy','sell']),clientOrderId:z.string(),filled:z.number().finite().positive(),cost:z.number().finite().positive(),average:z.number().finite().positive(),
  quotedTakerFeeRate:rate.optional(),fees:z.array(z.object({currency:z.string(),cost:z.number().finite().nonnegative()})).min(1),
  entryExecutionEvidence:z.object({venue:z.literal('okx-demo'),reference:z.literal('best_ask'),bestBid:z.number().finite().positive(),bestAsk:z.number().finite().positive(),spreadRate:rate,receivedAtUtc:z.iso.datetime(),bookTimestamp:z.number().int().positive().nullable()}).strict().optional(),
});
export type CostDiagnostic={generatedAt:string;records:Record<string,unknown>[];executionFidelity?:{snapshot?:unknown;tradingTerms?:unknown}};
const exportSchema=z.object({generatedAt:z.iso.datetime(),records:z.array(z.record(z.string(),z.unknown())),executionFidelity:z.object({snapshot:z.unknown(),tradingTerms:z.unknown().optional(),tradingTermsBySymbol:z.array(z.object({symbol,terms:z.unknown()})).max(20).optional()}).optional()});
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Observation={id:string;symbol:string;atUtc:string;source:'account_quote'|'terminal_fee'|'order_quote';rate:number;entryFeeCurrency?:'base'|'quote'};

/** Offline, allowlisted projection of exported evidence. No exchange or live state mutation. */
export function buildExecutionCostProfile(rawExports:unknown[],rawPlan:unknown,symbols:string[]){
  const plan=costPlanSchema.parse(rawPlan),exports=rawExports.map(x=>exportSchema.parse(x));
  const requested=z.array(symbol).min(2).parse(symbols);
  if(new Set(requested).size!==requested.length)throw new Error('Duplicate cost symbols');
  const snapshots=exports.flatMap(e=>e.executionFidelity?.snapshot?[validateExecutionSnapshot(e.executionFidelity.snapshot)]:[]).sort((a,b)=>Date.parse(a.capturedAtUtc)-Date.parse(b.capturedAtUtc));
  const snapshot=snapshots.at(-1);if(!snapshot)throw new Error('Applied execution snapshot required');
  if(snapshot.configuration.RISK_SIZING_ENABLED!==false)throw new Error('Reference currently supports fixed trade ceilings only');
  if(snapshot.exitPolicy&&(snapshot.exitPolicy.mode!=='fixed'||snapshot.exitPolicy.breakeven))throw new Error('A managed trailing/breakeven runtime requires a separately defined reference');
  const observations=new Map<string,Observation>(),orders=new Map<string,string>();
  const quoteMoves:Array<{symbol:string;atUtc:string;spreadRate:number;adverseAskToFillRate:number}>=[];
  let ignoredRows=0,unverifiedFeeRows=0,legacyQuoteReferences=0;
  const add=(o:Observation)=>{const old=observations.get(o.id);if(old&&JSON.stringify(old)!==JSON.stringify(o))throw new Error('Conflicting execution fee evidence');observations.set(o.id,o)};
  for(const e of exports){
    const quotes=[...(e.executionFidelity?.tradingTerms?[{symbol:null,terms:e.executionFidelity.tradingTerms}]:[]),...(e.executionFidelity?.tradingTermsBySymbol??[])];
    for(const quoted of quotes){const t=tradingTermsSchema.parse(quoted.terms);if(t.status==='confirmed'){
      if(quoted.symbol!==null&&quoted.symbol!==t.symbol)throw new Error('Quote symbol mismatch');
      if(Date.parse(t.observedAtUtc)>Date.parse(e.generatedAt)+60_000)throw new Error('Future account quote');
      add({id:sha(['quote',t.symbol,t.observedAtUtc]),symbol:t.symbol,atUtc:t.observedAtUtc,source:'account_quote',rate:rate.parse(t.takerFeeRate)});
    }}
    for(const row of e.records){
      if(row.section!=='demo_orders'||row.status!=='PLACED'){ignoredRows++;continue}
      const pair=symbol.safeParse(row.symbol),r=terminal.safeParse(row.result);
      if(!pair.success||!r.success||r.data.clientOrderId!==row.client_order_id){unverifiedFeeRows++;continue}
      const at=z.iso.datetime().parse(row.updated_at??row.created_at);if(Date.parse(at)>Date.parse(e.generatedAt)+60_000)throw new Error('Future terminal order');
      const data=r.data,base=pair.data.split('/')[0]!;
      const signature=sha([pair.data,data.side,data.filled,data.cost,data.average,data.fees,data.quotedTakerFeeRate??null,data.entryExecutionEvidence??null]);
      const key=sha([pair.data,row.client_order_id]);const prior=orders.get(key);if(prior&&prior!==signature)throw new Error('Conflicting duplicate terminal order');if(prior)continue;orders.set(key,signature);
      const currencies=new Set(data.fees.filter(f=>f.cost>0).map(f=>f.currency));
      if([...currencies].some(c=>c!==base&&c!=='USDT')||currencies.size>1||(data.side==='sell'&&currencies.has(base))){unverifiedFeeRows++;continue}
      const entryFeeCurrency=currencies.size?(currencies.has(base)?'base' as const:'quote' as const):undefined;
      const feeRate=data.fees.reduce((sum,f)=>sum+f.cost/(f.currency===base?data.filled:data.cost),0);
      add({id:key,symbol:pair.data,atUtc:at,source:'terminal_fee',rate:rate.parse(feeRate),...(data.side==='buy'&&entryFeeCurrency?{entryFeeCurrency}:{})});
      if(data.quotedTakerFeeRate!==undefined)add({id:key+'q',symbol:pair.data,atUtc:at,source:'order_quote',rate:data.quotedTakerFeeRate});
      const book=data.entryExecutionEvidence;
      if(data.side==='buy'&&book){
        const measured=2*(book.bestAsk-book.bestBid)/(book.bestAsk+book.bestBid);
        if(book.bestAsk<book.bestBid||Math.abs(measured-book.spreadRate)>1e-10||Date.parse(book.receivedAtUtc)>Date.parse(at)||Date.parse(at)-Date.parse(book.receivedAtUtc)>120_000)throw new Error('Invalid entry quote evidence');
        quoteMoves.push({symbol:pair.data,atUtc:at,spreadRate:book.spreadRate,adverseAskToFillRate:Math.max(0,data.average/book.bestAsk-1)});
      }else if(data.side==='buy')legacyQuoteReferences++;
    }
  }
  const profiles=requested.sort().map(pair=>{
    const rows=[...observations.values()].filter(o=>o.symbol===pair);
    const buys=rows.filter(o=>o.entryFeeCurrency!==undefined),modes=new Set(buys.map(o=>o.entryFeeCurrency));
    if(modes.size>1)throw new Error(`Mixed entry fee currencies for ${pair}`);
    const moves=quoteMoves.filter(o=>o.symbol===pair),max=(values:number[],floor:number)=>Math.max(floor,...values);
    return {symbol:pair,feeRate:rows.length?Math.max(...rows.map(o=>o.rate)):plan.fallbackFeeRate,
      feeEvidence:rows.length?'evidenced_maximum':'declared_fallback_assumption',feeObservations:rows.length,terminalFeeObservations:rows.filter(o=>o.source==='terminal_fee').length,
      earliestEvidenceUtc:rows.length?rows.map(o=>o.atUtc).sort()[0]!:null,latestEvidenceUtc:rows.length?rows.map(o=>o.atUtc).sort().at(-1)!:null,
      entryFeeCurrency:buys[0]?.entryFeeCurrency??'base' as const,entryFeeCurrencyEvidence:buys.length?'terminal_buy_fee':'declared_base_assumption',
      spreadRate:max(moves.map(o=>o.spreadRate),plan.assumedSpreadRate),slippageRate:max(moves.map(o=>o.adverseAskToFillRate),plan.assumedSlippageRate),
      quoteSamples:moves.length,executionCostEvidence:moves.length?'observed_buy_quote_with_assumption_floors':'declared_assumptions',
    };
  });
  return {status:'financial_reference_only' as const,plan,snapshot,profiles,
    evidence:{diagnosticHashes:rawExports.map(sha),configurationHashes:[...new Set(snapshots.map(s=>s.configurationHash))],sourceCommits:[...new Set(snapshots.map(s=>s.source.commitSha))],observations:[...observations.values()].map(({id,...safe})=>safe),ignoredRows,unverifiedFeeRows,legacyQuoteReferences},
    coverage:{symbols:profiles.length,feeEvidenced:profiles.filter(p=>p.feeObservations>0).length,feesAssumed:profiles.filter(p=>p.feeObservations===0).length,measuredBuyQuoteSymbols:profiles.filter(p=>p.quoteSamples>0).length},
    limitations:[
      'Exported evidence is not independently authenticated. Fees observed now are not reconstructed historical fees; this is an account-conditioned counterfactual replay of development data.',
      'Unknown symbols use the explicitly declared fallback; principal-pair fees are never labeled observed for another pair. Maximum evidenced rate is conservative, not a guarantee of future fees.',
      'Historical spread/depth and sell slippage are unknown. Buy best-ask-to-fill changes include latency and market movement; legacy referencePrice is not treated as measured slippage.',
      'Base entry fee and quote exit fee are modeled. Partial fills, exit lot-rounding/dust, trigger-price precision, actual scheduling and full live risk controls remain outside the proxy.',
      'Public live candles and the OKX Demo book are distinct venues; this reference does not establish real-versus-demo market equivalence or authorize real funds.',
    ]};
}
export function calibratedExecutionStudy(profile:ReturnType<typeof buildExecutionCostProfile>,rawStudy:unknown):UniverseStudy{
  const original=universeStudySchema.parse(rawStudy),c=profile.snapshot.configuration,s=profile.snapshot.settings;
  const n=(key:keyof typeof c)=>z.number().finite().parse(c[key]);
  const exitPolicy=exitPolicySchema.parse(profile.snapshot.exitPolicy??{mode:'fixed',breakeven:false,atrPeriod:n('ATR_PERIOD'),stopMultiplier:n('ATR_STOP_MULTIPLIER'),targetMultiplier:n('ATR_TAKE_PROFIT_MULTIPLIER'),minStopRate:n('ATR_MIN_STOP_RATE'),maxStopRate:n('ATR_MAX_STOP_RATE')});
  const scenario=(name:string,multiplier:number)=>({name,feeRate:Math.max(...profile.profiles.map(p=>p.feeRate))*multiplier,
    slippageRate:Math.max(...profile.profiles.map(p=>p.slippageRate))*multiplier,spreadRate:Math.max(...profile.profiles.map(p=>p.spreadRate))*multiplier,
    assumedDepthUsdt:original.scenarios[0]!.assumedDepthUsdt/multiplier,maxParticipationRate:original.scenarios[0]!.maxParticipationRate/multiplier,
    symbolCosts:Object.fromEntries(profile.profiles.map(p=>[p.symbol,{feeRate:p.feeRate*multiplier,slippageRate:p.slippageRate*multiplier,spreadRate:p.spreadRate*multiplier,entryFeeCurrency:p.entryFeeCurrency}]))});
  const declared=String(c.SIGNAL_SCAN_SYMBOLS??'').split(',').map(x=>x.trim()).filter(Boolean);
  return universeStudySchema.parse({...original,sizes:profile.plan.sizes,candleLimit:n('CANDLE_LIMIT'),fixedSymbols:declared.filter(pair=>profile.profiles.some(p=>p.symbol===pair)),
    initialBalanceUsdt:n('OKX_DEMO_BOT_BUDGET_USDT'),tradeSizeUsdt:s.demoOrderCeilingUsdt,minDailyQuoteVolumeUsdt:n('MARKET_MIN_QUOTE_VOLUME_USDT'),
    portfolio:{maxConcurrentPositions:s.maxPositions,maxExposureRate:n('RISK_MAX_EXPOSURE_PERCENT'),maxAltExposureRate:n('RISK_MAX_EXPOSURE_PERCENT')},
    parameters:{stopLossRate:n('OKX_DEMO_STOP_LOSS_RATE'),takeProfitRate:n('OKX_DEMO_TAKE_PROFIT_RATE'),minimumSignalScore:n('MIN_SIGNAL_SCORE'),maxBuyRsi:n('COMPILED_MAX_BUY_RSI'),btcRegimeFilter:c.BTC_REGIME_FILTER_ENABLED===true,executionDelayCandles:1,exitPolicy,
      ...(c.PAIR_COOLDOWN_ENABLED===true?{pairCooldown:{hours:n('PAIR_COOLDOWN_HOURS'),minLosses:n('PAIR_COOLDOWN_MIN_LOSSES')}}:{})},
    scenarios:[scenario('account-conditioned',1),scenario('account-cost-stress',profile.plan.stressMultiplier)]});
}
