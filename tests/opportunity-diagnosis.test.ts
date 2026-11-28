import { expect, it } from 'vitest';
import { diagnoseOpportunities, diagnoseBankCapacity } from '../src/opportunity-diagnosis.js';
import { comparisonSlippage } from '../src/strategy-comparison.js';
import type { HybridInstrument } from '../src/hybrid-research-replay.js';
const interval=900000;
const limits={riskPerTrade:.01,maxExposure:.25,maxAltExposure:.1,maxSymbolExposure:.15};
function fixture(base=true){
 const scenario={name:'model',feeRate:.004,slippageRate:.001,spreadRate:.0015,assumedDepthUsdt:1000,maxParticipationRate:.001,symbolCosts:{'BTC/USDT':{feeRate:.004,slippageRate:.001,spreadRate:.0015,entryFeeCurrency:base?'base' as const:'quote' as const}}};
 const s=comparisonSlippage(scenario),n=100,entryPrice=100*(1+s),exitPrice=103*(1-s),quantity=n/entryPrice*(base?.996:1),fee=n*.004+quantity*exitPrice*.004;
 const instruments:HybridInstrument[]=[{symbol:'BTC/USDT',candles15m:Array.from({length:12},(_,i)=>({timestamp:i*interval,open:100,high:102,low:99,close:100,volume:100})),candles1h:[],constraints:{minimumQuantity:.001,quantityStep:.001,minimumNotionalUsdt:0}}];
 const entries=[{symbol:'BTC/USDT',strategy_mode:'TREND_PULLBACK',decisionTimestamp:0,entryTimestamp:interval,notionalUsdt:n,stopPrice:98,targetPrice:104}];
 const trades=[{symbol:'BTC/USDT',strategy_mode:'TREND_PULLBACK',entryTimestamp:interval,exitTimestamp:3*interval,entryPrice,exitPrice,quantity,feesUsdt:fee,netPnlUsdt:quantity*exitPrice*.996-n*(base?1:1.004),reason:'TAKE_PROFIT',holdingCandles:3}];
 return {scenario,instruments,entries,trades,intervalMs:interval as 900000};
}
it('reconciles a base-fee trade into fixed-path movement, entry/exit friction and fee effect without double debits',()=>{
 const r=diagnoseOpportunities(fixture()).summary;
 expect(r.referencePathPnlUsdt).toBeCloseTo(3,10);
 expect(r.referencePathPnlUsdt-r.entryFrictionUsdt-r.exitFrictionUsdt-r.feeEffectUsdt).toBeCloseTo(r.netPnlUsdt,10);
 expect(r.baseFeeRevaluationUsdt).not.toBe(0);
 expect(r.beforeFeesAtFixedFillsUsdt-r.addBackRecordedFeesUsdt).toBeCloseTo(r.baseFeeRevaluationUsdt,10);
 expect(r.breakEvenMoveFromReferenceRate.mean).toBeGreaterThan(.008);
});
it('retains quote-fee cash basis and reports zero base-fee revaluation',()=>{
 const r=diagnoseOpportunities(fixture(false)).summary;
 expect(r.baseFeeRevaluationUsdt).toBeCloseTo(0,10);
 expect(r.beforeFeesAtFixedFillsUsdt).toBeCloseTo(r.addBackRecordedFeesUsdt,10);
});
it('excludes exit-bar extrema and future changes from owned MFE/MAE and labels post-exit horizons',()=>{
 const f=fixture(),before=diagnoseOpportunities(f);f.instruments[0]!.candles15m[3]!.high=200;
 const after=diagnoseOpportunities(f);
 expect(after.summary.mfeRate).toEqual(before.summary.mfeRate);
 expect(after.summary.forward.find(h=>h.bars===4)?.mfeRate.mean).toBeGreaterThan(.9);
 expect(after.summary.forward.find(h=>h.bars===4)?.includesExitOrLater).toBe(1);
});
it('keeps same-bar excursion and unavailable forward windows unknown rather than zero',()=>{
 const f=fixture();f.trades[0]!.exitTimestamp=interval;f.trades[0]!.holdingCandles=1;f.instruments[0]!.candles15m.length=2;
 const r=diagnoseOpportunities(f).summary;
 expect(r.ownedExcursionSamples).toBe(0);expect(r.mfeRate.mean).toBeNull();
 expect(r.forward.find(h=>h.bars===4)).toMatchObject({missingSamples:1,completeSamples:0});
});
it('rejects altered fees/fills, unmatched decisions, duplicate entries/trades and portfolio overlap',()=>{
 for(const field of ['feesUsdt','quantity','netPnlUsdt','entryPrice'] as const){const f=fixture();f.trades[0]![field]*=1.1;expect(()=>diagnoseOpportunities(f)).toThrow(/accounting/);}
 const f=fixture();f.entries[0]!.decisionTimestamp=interval;expect(()=>diagnoseOpportunities(f)).toThrow(/identity/);
 const d=fixture();d.entries.push(d.entries[0]!);expect(()=>diagnoseOpportunities(d)).toThrow(/Duplicate/);
 const t=fixture();t.trades.push(t.trades[0]!);expect(()=>diagnoseOpportunities(t)).toThrow(/Duplicate/);
 const o=fixture();o.entries.push({...o.entries[0]!,decisionTimestamp:interval,entryTimestamp:2*interval});o.trades.push({...o.trades[0]!,entryTimestamp:2*interval,holdingCandles:2});expect(()=>diagnoseOpportunities(o)).toThrow(/Overlapping/);
});
it('requires explicit 1h clocks and preserves diagnostic grouping without pooling distinct modes',()=>{
 const f=fixture();expect(()=>diagnoseOpportunities({...f,intervalMs:3600000})).toThrow(/candles/);
 for(const c of f.instruments[0]!.candles15m)c.timestamp*=4;
 for(const t of f.trades){t.entryTimestamp*=4;t.exitTimestamp*=4;}
 for(const e of f.entries){e.entryTimestamp*=4;e.decisionTimestamp*=4;}
 const r=diagnoseOpportunities({...f,intervalMs:3600000});expect(r.summary.holdingMinutesUpperBound.mean).toBe(180);expect(r.byMode[0]!.key).toBe('TREND_PULLBACK');expect(r.byEntrySessionUtc[0]!.key).toBe('00–06');
});
it('rejects candle gaps, invalid prices and absent trade clocks; empty cases retain unknown EV',()=>{
 const f=fixture();f.instruments[0]!.candles15m[2]!.timestamp++;expect(()=>diagnoseOpportunities(f)).toThrow(/candles/);
 const p=fixture();p.instruments[0]!.candles15m[2]!.low=-1;expect(()=>diagnoseOpportunities(p)).toThrow(/candles/);
 const m=fixture();m.trades[0]!.symbol='ETH/USDT';expect(()=>diagnoseOpportunities(m)).toThrow(/identity/);
 expect(diagnoseOpportunities({...fixture(),entries:[],trades:[]}).summary).toMatchObject({trades:0,expectancyUsdt:null,profitFactor:null});
});
const snapshot=()=>({status:'read_only_account_terms_snapshot',environment:'real',capturedAtUtc:'2026-11-23T00:00:00Z',entryFeeCurrency:'base',balance:{availableUsdt:null,cashUsdt:null,liabilityUsdt:null,usableCashStatus:'requires_account_review'},terms:[{symbol:'BTC/USDT',instrumentStatus:'live_spot_rules_observed',minimumQuantity:.001,quantityStep:.001,priceTick:.1,minimumNotionalUsdt:null,feeStatus:'account_pair_quote',takerFeeRate:.004}]});
it('keeps stale cash/maker/notional unknown and limits capacity to dated conditional exposure, never order approval',()=>{
 const r=diagnoseBankCapacity(snapshot(),fixture().instruments,limits,Date.parse('2026-11-26T00:00:00Z'));
 expect(r).toMatchObject({accountFresh:false,cashConfirmed:false,ordersSent:0,realMoneyApproved:false});
 expect(r.rows[0]).toMatchObject({exposureCeilingUsdt:2.55,conditionalQuantityPass:true,makerQuoteRate:null,minimumNotionalUsdt:null,liveTradingEligible:false});
 const s=snapshot();s.terms[0]!.minimumQuantity=10;expect(diagnoseBankCapacity(s,fixture().instruments,limits,Date.parse('2026-11-26T00:00:00Z')).rows[0]!.conditionalQuantityPass).toBe(false);
});
it('accounts for a base fee dropping sellable size below minimum and caps alt exposure at 1.70',()=>{
 const s=snapshot();s.terms[0]!.minimumQuantity=.025;s.terms[0]!.quantityStep=.001;
 expect(diagnoseBankCapacity(s,fixture().instruments,limits,Date.parse('2026-11-26T00:00:00Z')).rows[0]).toMatchObject({quantity:.025,sellableQuantity:.024,conditionalQuantityPass:false});
 const alt=snapshot();alt.terms[0]!.symbol='SOL/USDT';const instruments=fixture().instruments;instruments[0]!.symbol='SOL/USDT';expect(diagnoseBankCapacity(alt,instruments,limits,Date.parse('2026-11-26T00:00:00Z')).rows[0]!.exposureCeilingUsdt).toBeCloseTo(1.7);
});
it('rejects duplicate snapshot terms and future snapshots rather than treating them as valid',()=>{
 const s=snapshot();s.terms.push(s.terms[0]!);expect(()=>diagnoseBankCapacity(s,fixture().instruments,limits,Date.parse('2026-11-26T00:00:00Z'))).toThrow(/identity/);
 expect(()=>diagnoseBankCapacity(snapshot(),fixture().instruments,limits,0)).toThrow(/identity/);
});
