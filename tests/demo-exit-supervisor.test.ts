import { describe, expect, it, vi } from "vitest";
import { superviseDemoExits } from "../src/demo-exit-supervisor.js";
import { demoExitStateSchema } from "../src/demo-exit-state.js";
const end=Math.floor(Date.now()/900000)*900000-900000;
function setup(){
  let row={algo_client_id:"AP1",client_order_id:"CB1",symbol:"BTC/USDT",version:0,status:"PLACED",result:{orderId:"1"},created_at:new Date(end-20*900000),state:demoExitStateSchema.parse({policy:{mode:"trailing_atr",trailingMultiplier:2},accountIdentity:{uid:"1",mainUid:"1"},lastCandle:end-900000,highWatermark:100})};
  let stop=95;
  const store={managedDemoExits:vi.fn(async()=>[structuredClone(row)]),saveDemoExitState:vi.fn(async(_id:string,version:number,state:typeof row.state)=>{if(row.version!==version)return false;row={...row,version:version+1,state:structuredClone(state)};return true;})};
  const executor={exitManagementEnabled:true,inspectAccountIdentity:vi.fn(async()=>({status:"confirmed" as const,identity:{uid:"1",mainUid:"1"}})),inspectExitProtection:vi.fn(async()=>({status:"live" as const,unprotectedDustQuantity:0,stop,algoId:"2",quantity:1,netQuantity:1,costUsdt:100,entryPrice:100,entryCandle:end-10*900000,takerFeeRate:.001,requestId:null})),formatExitStop:(_s:string,p:number)=>p,amendExitStop:vi.fn(async()=>"acknowledged" as const)};
  const market={active:"okx" as const,fetchClosedCandles:vi.fn(async()=>Array.from({length:20},(_,i)=>({timestamp:end-(19-i)*900000,open:110,high:111,low:109,close:110,volume:1000})))};
  return {store,executor,market,row:()=>row,setStop:(v:number)=>{stop=v;}};
}
describe("durable stop amendment supervision",()=>{
  it("reserves before sending, waits for readback across restarts, and never repeats uncertain writes",async()=>{
    const f=setup();
    expect(await superviseDemoExits(f.store,f.executor,f.market)).toMatchObject({reason:"exit_amendment_awaiting_readback"});
    expect(f.row().state.pending?.stop).toBe(107);
    expect(await superviseDemoExits(f.store,f.executor,f.market)).toMatchObject({reason:"exit_amendment_unconfirmed"});
    expect(f.executor.amendExitStop).toHaveBeenCalledTimes(1);
    f.setStop(107);
    expect(await superviseDemoExits(f.store,f.executor,f.market)).toEqual({status:"safe"});
    expect(f.row().state.pending).toBeNull();
    expect(f.row().state.stop).toBe(107);
    await superviseDemoExits(f.store,f.executor,f.market);
    expect(f.executor.amendExitStop).toHaveBeenCalledTimes(1);
  });
  it("submits nothing on write failure or competing reservations",async()=>{
    const f=setup();f.store.saveDemoExitState.mockResolvedValue(false);
    expect(await superviseDemoExits(f.store,f.executor,f.market)).toMatchObject({reason:"exit_state_changed"});
    expect(f.executor.amendExitStop).not.toHaveBeenCalled();
    const g=setup();await Promise.all([superviseDemoExits(g.store,g.executor,g.market),superviseDemoExits(g.store,g.executor,g.market)]);
    expect(g.executor.amendExitStop).toHaveBeenCalledTimes(1);
  });
  it("keeps pending durable after an exception; disabled mode audits without mutations",async()=>{
    const f=setup();f.executor.amendExitStop.mockRejectedValueOnce(Error("timeout"));
    expect(await superviseDemoExits(f.store,f.executor,f.market)).toMatchObject({reason:"exit_supervision_failed"});
    expect(f.row().state.pending).not.toBeNull();
    await superviseDemoExits(f.store,f.executor,f.market);
    expect(f.executor.amendExitStop).toHaveBeenCalledTimes(1);
    const g=setup();g.executor.exitManagementEnabled=false;
    expect(await superviseDemoExits(g.store,g.executor,g.market)).toEqual({status:"safe"});
    expect(g.executor.inspectExitProtection).toHaveBeenCalled();
    expect(g.store.saveDemoExitState).not.toHaveBeenCalled();
  });
  it("rejects account mismatch, candle gaps, fallback data, and lowered stops",async()=>{
    const f=setup();f.executor.inspectAccountIdentity.mockResolvedValue({status:"confirmed",identity:{uid:"2",mainUid:"1"}});
    expect(await superviseDemoExits(f.store,f.executor,f.market)).toMatchObject({reason:"exit_account_mismatch"});
    const g=setup();g.market.fetchClosedCandles.mockResolvedValue([]);
    expect(await superviseDemoExits(g.store,g.executor,g.market)).toMatchObject({reason:"exit_candles_invalid"});
    const h=setup();await superviseDemoExits(h.store,h.executor,h.market);h.setStop(107);await superviseDemoExits(h.store,h.executor,h.market);h.setStop(94);
    expect(await superviseDemoExits(h.store,h.executor,h.market)).toMatchObject({reason:"exit_stop_regressed"});
  });
});
