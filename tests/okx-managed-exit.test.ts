import { auditDemoProtections } from "../src/demo-exit-supervisor.js";
import ccxt, { type Exchange } from "ccxt";
import { describe, expect, it, vi } from "vitest";
import { OkxDemoExecutor } from "../src/okx-demo.js";
import { exitPolicySchema } from "../src/exit-policy.js";
const journal={orderId:"1",clientOrderId:"CB1",attachedAlgoClientId:"AP1",symbol:"BTC/USDT"};
function setup(){
  const now=Date.now();
  const algo={instType:"SPOT",instId:"BTC-USDT",algoClOrdId:"AP1",algoId:"2",side:"sell",state:"live",ordIdList:[],slOrdPx:"-1",slTriggerPxType:"last",ordType:"conditional",sz:"0.999",slTriggerPx:"95"};
  const exchange={precisionMode:ccxt.TICK_SIZE,setSandboxMode:vi.fn(),loadMarkets:vi.fn(async()=>({})),market:vi.fn(()=>({symbol:"BTC/USDT",spot:true,active:true,quote:"USDT",base:"BTC",precision:{amount:.001},limits:{cost:{min:1}}})),fetchBalance:vi.fn(async()=>({free:{USDT:1000,BTC:.999},total:{USDT:1000,BTC:.999}})),fetchTicker:vi.fn(async()=>({bid:110,ask:111})),fetchTradingFee:vi.fn(async()=>({taker:.002})),priceToPrecision:(_s:string,p:number)=>String(p),
    privateGetTradeOrder:vi.fn(async()=>({code:"0",data:[{instType:"SPOT",instId:"BTC-USDT",ordId:"1",clOrdId:"CB1",side:"buy",state:"filled",accFillSz:"1",attachAlgoOrds:[{attachAlgoClOrdId:"AP1"}]}]})),
    privateGetTradeOrderAlgo:vi.fn(async()=>({code:"0",data:[algo]})),
    privateGetTradeFills:vi.fn(async(p:Record<string,string>)=>({code:"0",data:p.after?[]:[{billId:"123",instType:"SPOT",instId:"BTC-USDT",ordId:"1",side:"buy",fillSz:"1",fillPx:"100",fee:"-0.001",feeCcy:"BTC",fillTime:String(now-1000),ts:String(now-1000)}]})),privateGetTradeFillsHistory:vi.fn(async()=>({code:"0",data:[]})),
    privatePostTradeAmendAlgos:vi.fn(async(p:Record<string,unknown>)=>({code:"0",data:[{algoId:"2",reqId:p.reqId,sCode:"0"}]}))};
  const executor=new OkxDemoExecutor({apiKey:"test",secretKey:"test",passphrase:"test"},{symbol:"BTC/USDT",tradingEnabled:true,orderSizeUsdt:10,stopLossRate:.01,takeProfitRate:.02,exitPolicy:exitPolicySchema.parse({mode:"trailing_atr"})},exchange as unknown as Exchange);
  executor.setExitReservationCheck(async()=>true);
  return {executor,exchange,algo,from:now-60000};
}
describe("OKX managed stop protocol",()=>{
  it("distinguishes a failed preflight read from a failed amendment request", async () => {
    const f = setup();
    await f.executor.initialize();

    f.exchange.fetchTicker.mockRejectedValueOnce(new Error("ticker timeout"));
    expect(await f.executor.amendExitStop(journal, f.from, 105, "REQ1")).toBe("blocked");
    expect(f.exchange.privatePostTradeAmendAlgos).not.toHaveBeenCalled();

    f.exchange.privatePostTradeAmendAlgos.mockRejectedValueOnce(new Error("amendment timeout"));
    await expect(f.executor.amendExitStop(journal, f.from, 105, "REQ2")).rejects.toThrow("amendment timeout");
    expect(f.exchange.privatePostTradeAmendAlgos).toHaveBeenCalledTimes(1);
  });

  it("uses net acquired quantity and complete fees, then amends only the existing stop",async()=>{
    const f=setup();await f.executor.initialize();
    expect(await f.executor.inspectExitProtection(journal,f.from)).toMatchObject({status:"live",quantity:.999,netQuantity:.999,costUsdt:100,takerFeeRate:.002});
    expect(await f.executor.amendExitStop(journal,f.from,105,"REQ1")).toBe("acknowledged");
    expect(f.exchange.privatePostTradeAmendAlgos).toHaveBeenCalledWith({instId:"BTC-USDT",algoId:"2",reqId:"REQ1",newSlTriggerPx:"105",newSlOrdPx:"-1",cxlOnFail:false});
  });
  it("refuses partial/unprotected quantities, missing reservations and crossed stops",async()=>{
    const f=setup();await f.executor.initialize();f.algo.sz="0.5";
    expect(await f.executor.inspectExitProtection(journal,f.from)).toMatchObject({reason:"exit_quantity_not_covered"});
    f.algo.sz="0.998";
    expect(await f.executor.inspectExitProtection(journal,f.from)).toMatchObject({reason:"exit_quantity_not_covered"});
    f.algo.sz="1";
    expect(await f.executor.inspectExitProtection(journal,f.from)).toMatchObject({reason:"exit_quantity_not_covered"});
    f.algo.sz="0.999";
    expect(await f.executor.amendExitStop(journal,f.from,111,"REQ1")).toBe("blocked");
    f.executor.setExitReservationCheck(async()=>false);
    expect(await f.executor.amendExitStop(journal,f.from,105,"REQ1")).toBe("blocked");
    expect(f.exchange.privatePostTradeAmendAlgos).not.toHaveBeenCalled();
  });
  it("does not classify an open partial buy as safely protected",async()=>{
    const f=setup();await f.executor.initialize();
    const original=await f.exchange.privateGetTradeOrder();original.data[0]!.state="partially_filled";f.exchange.privateGetTradeOrder.mockResolvedValue(original);
    expect(await f.executor.inspectExitProtection(journal,f.from)).toMatchObject({reason:"partial_buy_or_parent_pending"});
    expect(f.exchange.privatePostTradeAmendAlgos).not.toHaveBeenCalled();
  });
  it("correlates an explicit rejection separately from an uncertain response",async()=>{
    const f=setup();await f.executor.initialize();f.exchange.privatePostTradeAmendAlgos.mockResolvedValue({code:"1",data:[{algoId:"2",reqId:"REQ1",sCode:"51000"}]});
    expect(await f.executor.amendExitStop(journal,f.from,105,"REQ1")).toBe("rejected");
  });
  it("blocks a partially executed protective sell without another submission",async()=>{
    const f=setup();await f.executor.initialize();
    vi.spyOn(f.executor,"collectOrderEvidence").mockResolvedValue({status:"collected",buys:[],sells:[],protections:[],protectionStates:{AP1:"effective"},orders:[{id:"1",symbol:"BTC/USDT",side:"buy",filled:1,terminal:true,ownershipConfirmed:false},{id:"3",symbol:"BTC/USDT",side:"sell",filled:.4,terminal:false,ownershipConfirmed:false}]});
    expect(await f.executor.inspectExitProtection(journal,f.from)).toMatchObject({reason:"partial_sell_or_child_pending"});
    expect(f.exchange.privatePostTradeAmendAlgos).not.toHaveBeenCalled();
  });
  it("reports net residual and protection state without unblocking a canceled stop", async () => {
    const f = setup();
    await f.executor.initialize();
    f.algo.state = "canceled";
    expect(await f.executor.inspectExitProtection(journal, f.from)).toMatchObject({
      status: "blocked", reason: "partial_exit_without_live_coverage",
      positionEvidence: { symbol: "BTC/USDT", buyOrderId: "1", protectionState: "canceled",
        grossBought: 1, grossSold: 0, remainingNet: 0.999, amountStep: 0.001, sellOrders: [] },
    });
    expect(f.exchange.privatePostTradeAmendAlgos).not.toHaveBeenCalled();
  });
  it("keeps rejected or mismatched acknowledgements uncertain, preserving the existing protection",async()=>{
    const f=setup();await f.executor.initialize();f.exchange.privatePostTradeAmendAlgos.mockResolvedValue({code:"0",data:[{algoId:"2",reqId:"OTHER",sCode:"51000"}]});
    expect(await f.executor.amendExitStop(journal,f.from,105,"REQ1")).toBe("uncertain");
    expect(f.algo.slTriggerPx).toBe("95");
  });
});

it("requires the exact persisted buy and proves net stop coverage after a fresh start", async () => {
  const initial = setup();
  const restarted = setup();
  const row = {
    client_order_id: journal.clientOrderId, symbol: journal.symbol, status: "PLACED",
    result: { orderId: journal.orderId }, attached_algo_client_id: journal.attachedAlgoClientId,
    created_at: new Date(initial.from),
  };
  const identity = { uid: "1", mainUid: "1" };
  const store = {
    demoOrderJournal: vi.fn(async () => [row]),
    getDemoBaselineCandidate: async () => ({
      observedAt: new Date(initial.from - 60_000), evidence: { accountIdentity: identity },
      balances: {}, status: "UNVERIFIED",
    }),
    getDemoAccountingCheckpoint: async () => null,
  };
  const readOnlyAudit = (executor: OkxDemoExecutor) => ({
    inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity }),
    inspectExitProtection: executor.inspectExitProtection.bind(executor),
  });
  await initial.executor.initialize();
  await restarted.executor.initialize();

  store.demoOrderJournal.mockResolvedValueOnce([]);
  await expect(auditDemoProtections(store, readOnlyAudit(initial.executor), journal)).resolves.toMatchObject({
    status: "blocked", reason: "protection_order_not_persisted",
  });
  initial.exchange.privateGetTradeOrderAlgo.mockRejectedValueOnce(new Error("stop readback failed"));
  await expect(auditDemoProtections(store, readOnlyAudit(initial.executor), journal)).resolves.toMatchObject({ status: "blocked" });

  restarted.algo.sz = "0.998";
  await expect(auditDemoProtections(store, readOnlyAudit(restarted.executor))).resolves.toMatchObject({
    status: "blocked", reason: "exit_quantity_not_covered",
  });
  restarted.algo.sz = "0.999";
  await expect(auditDemoProtections(store, readOnlyAudit(restarted.executor))).resolves.toEqual({ status: "safe" });
  expect(restarted.exchange.privatePostTradeAmendAlgos).not.toHaveBeenCalled();
});
