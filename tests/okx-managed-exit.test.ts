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
  it("keeps rejected or mismatched acknowledgements uncertain, preserving the existing protection",async()=>{
    const f=setup();await f.executor.initialize();f.exchange.privatePostTradeAmendAlgos.mockResolvedValue({code:"0",data:[{algoId:"2",reqId:"OTHER",sCode:"51000"}]});
    expect(await f.executor.amendExitStop(journal,f.from,105,"REQ1")).toBe("uncertain");
    expect(f.algo.slTriggerPx).toBe("95");
  });
});
