import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect,it } from 'vitest';
import { previewSpotEntry,SpotInstrumentCache } from '../src/spot-entry-preflight.js';
const now=Date.parse('2026-11-24T16:00:00Z'),at=new Date(now).toISOString();
const snapshot=()=>({status:'read_only_account_terms_snapshot',environment:'real',capturedAtUtc:at,entryFeeCurrency:'base',balance:{usableCashStatus:'spot_cash_observed',availableUsdt:17,cashUsdt:17,liabilityUsdt:0},terms:[{symbol:'BTC/USDT',instrumentStatus:'live_spot_rules_observed',minimumQuantity:.0001,quantityStep:.0001,priceTick:.01,takerFeeRate:.004,makerFeeRate:.002}]});
const proposal=()=>({symbol:'BTC/USDT',environment:'real',entryStyle:'taker',bid:99.9,ask:100,bookObservedAtUtc:at,stopPrice:98.001,targetPrice:105.009,lotCeilingUsdt:10,minimumNetRewardRisk:1,minimumNetGainCostMultiple:1,riskLimits:{riskPerTrade:.01,maxExposure:.25,maxAltExposure:.1,maxSymbolExposure:.15},exposureUsdt:0,altExposureUsdt:0,symbolExposureUsdt:0,openPositions:0,pendingOrders:0,accountReconciled:true,slippageRate:.001,maximumSpreadRate:.005,availableDepthUsdt:1000,verifiedMinimumNotionalUsdt:.1});
it('previews precision, entry/exit fees and sellable quantity while preserving the 17-USDT risk caps',()=>{
 const r=previewSpotEntry(snapshot(),proposal(),now);expect(r.status).toBe('structural_preview_passed');if(!('quantity'in r))throw Error('preview missing');
 expect(r.stopPrice).toBe(98);expect(r.targetPrice).toBe(105);expect(r.sellableQuantity).toBeLessThan(r.quantity);expect(r.cashCostUsdt).toBeLessThanOrEqual(2.55);expect(r.estimatedStopLossUsdt).toBeLessThanOrEqual(.17);expect(r.netGainUsdt).toBeGreaterThan(0);expect(r.orderSubmissionApproved).toBe(false);expect(r.realMoneyApproved).toBe(false);
});
it('keeps unknown notional limits pending rather than silently treating them as zero',()=>{
 const r=previewSpotEntry(snapshot(),{...proposal(),verifiedMinimumNotionalUsdt:null},now);expect(r.status).toBe('limits_pending');expect(r.orderSubmissionApproved).toBe(false);
 expect(previewSpotEntry(snapshot(),{...proposal(),verifiedMinimumNotionalUsdt:5},now)).toMatchObject({reason:'minimum_notional'});
});
it('rejects stale quotes, account/environment uncertainty, pending orders and unreconciled state',()=>{
 expect(previewSpotEntry(snapshot(),proposal(),now+5001)).toMatchObject({reason:'stale_account_or_book'});
 expect(previewSpotEntry(snapshot(),{...proposal(),environment:'demo'},now)).toMatchObject({reason:'account_environment_mismatch'});
 expect(previewSpotEntry({...snapshot(),balance:{...snapshot().balance,liabilityUsdt:1}},proposal(),now)).toMatchObject({reason:'spendable_cash_unconfirmed'});
 expect(previewSpotEntry(snapshot(),{...proposal(),pendingOrders:1},now)).toMatchObject({reason:'position_or_order_pending'});
 expect(previewSpotEntry(snapshot(),{...proposal(),accountReconciled:false},now)).toMatchObject({reason:'account_not_reconciled'});
});
it('rejects an entry whose base fee leaves less than the exchange sell minimum',()=>{
 const s=snapshot();s.terms[0]!.minimumQuantity=.0254;expect(previewSpotEntry(s,proposal(),now)).toMatchObject({reason:'minimum_quantity_after_fee'});
});
it('requires an observed maker rate, keeps exit taker costs and never assumes post-only execution',()=>{
 const s=snapshot();delete (s.terms[0] as any).makerFeeRate;
 expect(previewSpotEntry(s,{...proposal(),entryStyle:'post_only'},now)).toMatchObject({reason:'fee_or_currency_unconfirmed'});
 const r=previewSpotEntry(snapshot(),{...proposal(),entryStyle:'post_only'},now);expect(r).toMatchObject({entryFeeRate:.002,exitFeeRate:.004,orderSubmissionApproved:false});
});
it('blocks insufficient net target, spread, RR and liquidity without enlarging the lot',()=>{
 expect(previewSpotEntry(snapshot(),{...proposal(),targetPrice:100.5},now)).toMatchObject({reason:'target_does_not_cover_costs'});
 expect(previewSpotEntry(snapshot(),{...proposal(),minimumNetRewardRisk:100},now)).toMatchObject({reason:'net_reward_risk'});
 expect(previewSpotEntry(snapshot(),{...proposal(),maximumSpreadRate:.0001},now)).toMatchObject({reason:'book_or_spread_invalid'});
 expect(previewSpotEntry(snapshot(),{...proposal(),availableDepthUsdt:0},now)).toMatchObject({reason:'risk_cap_cash_or_liquidity'});
 expect(()=>previewSpotEntry(snapshot(),{...proposal(),lotCeilingUsdt:17},now)).toThrow();
});
it('caches only distinct live watchlist instruments, expires them and preserves unknown quote minimum',()=>{
 const cache=new SpotInstrumentCache(1000),row={instId:'BTC-USDT',instType:'SPOT',quoteCcy:'USDT',state:'live',minSz:'.0001',lotSz:'.0001',tickSz:'.01'};
 cache.update([row,{...row,instId:'USDC-USDT'}],now);expect(cache.get('BTC/USDT',now)?.minimumNotionalUsdt).toBeNull();expect(cache.get('USDC/USDT',now)).toBeNull();expect(cache.get('BTC/USDT',now+1000)).toBeNull();expect(cache.get('BTC/USDT',NaN)).toBeNull();
 cache.update([row,row],now);expect(cache.get('BTC/USDT',now)).toBeNull();cache.update([{...row,state:'suspend'}],now);expect(cache.get('BTC/USDT',now)).toBeNull();
});

it('CLI makes a bounded offline preview from files, sends no orders and refuses output overwrite',()=>{
 const root=mkdtempSync(join(tmpdir(),'spot-preflight-'));
 try{const sp=join(root,'snapshot.json'),pr=join(root,'proposal.json'),out=join(root,'out');writeFileSync(sp,JSON.stringify(snapshot()));writeFileSync(pr,JSON.stringify(proposal()));
  const args=['--import','tsx',new URL('../src/spot-entry-preflight-cli.ts',import.meta.url).pathname,sp,pr,out];
  execFileSync(process.execPath,args,{stdio:'pipe'});const r=JSON.parse(readFileSync(join(out,'preflight.json'),'utf8'));expect(r.ordersSent).toBe(0);expect(r.realMoneyApproved).toBe(false);expect(()=>execFileSync(process.execPath,args,{stdio:'pipe'})).toThrow(/EEXIST/);
 }finally{rmSync(root,{recursive:true,force:true});}
},15000);
