import { expect,it } from "vitest";
import { diagnoseEntryEconomics } from "../src/economic-diagnosis.js";
import type { DiagnosticTrade } from "../src/strategy-diagnostics.js";
import type { UniverseDataset } from "../src/universe-comparison.js";
const step=900000;
const scenario={name:'standard',feeRate:0,slippageRate:0,spreadRate:0,assumedDepthUsdt:1000,maxParticipationRate:.001};
const data=():UniverseDataset[]=>[{symbol:'BTC/USDT',constraints:{minimumNotionalUsdt:0,minimumQuantity:.001,quantityStep:.001},quoteVolumesUsdt:Array(112).fill(10000),candles:Array.from({length:112},(_,i)=>({timestamp:i*step,open:100,high:101,low:99,close:100,volume:100}))}];
const trade=(overrides:Partial<DiagnosticTrade>={}):DiagnosticTrade=>({symbol:'BTC/USDT',entryTimestamp:100*step,exitTimestamp:102*step,entryPrice:100,exitPrice:99,quantity:1,feesUsdt:0,netPnlUsdt:-1,reason:'STOP_LOSS',entryContext:{decisionTimestamp:99*step,rsi14:60,btcState:'allowed'},...overrides});
it('excludes the exit-bar high from owned excursion and labels subsequent price paths as ex-post',()=>{
 const d=data();d[0]!.candles[102]!.high=200;
 const r=diagnoseEntryEconomics([trade()],d,scenario,100);
 expect(r.ownedFavorableMoveRate.mean).toBeCloseTo(.01);
 expect(r.horizons.find(h=>h.bars===4)).toMatchObject({completeSamples:1,includesExitOrLater:1,favorableMoveRate:{mean:1}});
 expect(r.accounting.beforeFeesPnlUsdt).toBe(-1);
});
it('reports same-bar excursion as unknown and incomplete future horizons as missing, not zero',()=>{
 const r=diagnoseEntryEconomics([trade({entryTimestamp:111*step,exitTimestamp:111*step,entryContext:{decisionTimestamp:110*step}})],data(),scenario,100);
 expect(r.ownedExcursionCoverage).toBe(0);expect(r.ownedFavorableMoveRate.mean).toBeNull();
 expect(r.horizons.find(h=>h.bars===8)).toMatchObject({completeSamples:0,missingSamples:1,meanCloseMoveRate:null});
});
it('uses only the exact preceding decision and its candle window for entry attributes',()=>{
 const d=data(), first=diagnoseEntryEconomics([trade()],d,scenario,100);
 for(let i=100;i<112;i++)d[0]!.candles[i]!.high=200;
 const after=diagnoseEntryEconomics([trade()],d,scenario,100);
 expect(after.atrRate).toEqual(first.atrRate);expect(after.extensionFromEma21Atr).toEqual(first.extensionFromEma21Atr);
 const missing=trade();delete missing.entryContext;
 expect(diagnoseEntryEconomics([missing],d,scenario,100).atrRate.samples).toBe(0);
 expect(()=>diagnoseEntryEconomics([trade({entryContext:{decisionTimestamp:100*step}})],d,scenario,100)).toThrow(/precede/);
});
it('models base buy fee and quote sell fee without charging entry slippage twice',()=>{
 const fee=.004,qty=.996,entry=100,exit=101;
 const t=trade({entryPrice:entry,exitPrice:exit,quantity:qty,feesUsdt:.4+exit*qty*fee,netPnlUsdt:exit*qty*(1-fee)-100});
 const s={...scenario,feeRate:fee,slippageRate:.001,symbolCosts:{'BTC/USDT':{feeRate:fee,slippageRate:.001,spreadRate:0,entryFeeCurrency:'base' as const}}};
 const r=diagnoseEntryEconomics([t],data(),s,100);
 expect(r.horizons[0]!.highReachedEstimatedBreakEven).toBe(1);
 expect(r.accounting.feesUsdt).toBeCloseTo(.802384);
 expect(r.breakEvenMarketMoveRate.mean).toBeCloseTo(1/(1-fee)**2/(1-.001)-1,12);
 const inconsistent=structuredClone(s);inconsistent.feeRate=.002;inconsistent.symbolCosts['BTC/USDT'].feeRate=.002;
 expect(()=>diagnoseEntryEconomics([t],data(),inconsistent,100)).toThrow(/fees differ/);
});
it('retains quote-fee cash basis and does not pool exit reasons or BTC classifications',()=>{
 const fee=.004,fees=100*fee+101*fee;
 const s={...scenario,feeRate:fee};
 const t=trade({exitPrice:101,feesUsdt:fees,netPnlUsdt:1-fees});
 const other=trade({entryTimestamp:104*step,exitTimestamp:106*step,exitPrice:101,feesUsdt:fees,netPnlUsdt:1-fees,reason:'TAKE_PROFIT',entryContext:{decisionTimestamp:103*step,btcState:'btc_regime_downtrend'}});
 const r=diagnoseEntryEconomics([t,other],data(),s,100);
 expect(r.byExitReason).toHaveLength(2);expect(r.byBtcEntryState).toHaveLength(2);
 expect(r.accounting.realizedPnlUsdt).toBeCloseTo(2*(1-fees));
 expect(()=>diagnoseEntryEconomics([t,t],data(),s,100)).toThrow(/Duplicate/);
});
it('rejects a missing symbol, discontinuous data or an unmatched execution timestamp',()=>{
 expect(()=>diagnoseEntryEconomics([trade({symbol:'ETH/USDT'})],data(),scenario,100)).toThrow(/clock/);
 expect(()=>diagnoseEntryEconomics([trade({entryTimestamp:100*step+1})],data(),scenario,100)).toThrow(/clock/);
 const d=data();d[0]!.candles[100]!.timestamp++;
 expect(()=>diagnoseEntryEconomics([trade()],d,scenario,100)).toThrow(/contiguous/);
});
