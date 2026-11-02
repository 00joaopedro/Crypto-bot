import { describe, expect, it, vi } from "vitest";
import { collectOkxDemoOrderEvidence } from "../src/okx-demo-order-evidence.js";

const journal = [{ orderId: "101", clientOrderId: "CB1", symbol: "BTC/USDT", attachedAlgoClientId: "AP1" }];
const order = (id: string, side: "buy" | "sell", state = "filled") => ({ code: "0", data: [{ instType: "SPOT", instId: "BTC-USDT", ordId: id, side, clOrdId: side === "buy" ? "CB1" : "", state, accFillSz: "0.5", attachAlgoOrds: side === "buy" ? [{ attachAlgoClOrdId: "AP1" }] : [] }] });
const protection = (state = "effective", ids: unknown[] = ["202"]) => ({ code: "0", data: [{ instType: "SPOT", instId: "BTC-USDT", algoClOrdId: "AP1", algoId: "303", side: "sell", state, ordIdList: ids }] });
const setup = () => ({ privateGetTradeOrder: vi.fn(async (params: Record<string, string>) => params.ordId === "101" ? order("101", "buy") : order("202", "sell")), privateGetTradeOrderAlgo: vi.fn(async () => protection()) });
describe("OKX Demo order evidence", () => {
  it("reads exact parent, attached algo and spawned order without assuming ownership or coverage", async () => {
    const client = setup();
    const result = await collectOkxDemoOrderEvidence(client, journal);
    expect(result.status).toBe("collected");
    if (result.status !== "collected") return;
    expect(result.orders).toEqual(expect.arrayContaining([expect.objectContaining({ id: "101", ownershipConfirmed: false }), expect.objectContaining({ id: "202", ownershipConfirmed: false })]));
    expect(result.protections[0]?.spawnedOrderIds).toEqual(["202"]);
    expect(client.privateGetTradeOrder).toHaveBeenCalledWith({ instId: "BTC-USDT", ordId: "101" });
    expect(client.privateGetTradeOrderAlgo).toHaveBeenCalledWith({ algoClOrdId: "AP1" });
  });
  it("refuses missing journal identity, altered parents, unknown spawned IDs and empty effective results", async () => {
    expect(await collectOkxDemoOrderEvidence(setup(), [{ ...journal[0]!, attachedAlgoClientId: null }])).toMatchObject({ reason: "invalid_or_incomplete_journal" });
    const wrongParent = setup(); wrongParent.privateGetTradeOrder.mockResolvedValue(order("101", "sell"));
    expect(await collectOkxDemoOrderEvidence(wrongParent, journal)).toMatchObject({ reason: "parent_order_unconfirmed" });
    const wrongIds = setup(); wrongIds.privateGetTradeOrderAlgo.mockResolvedValue(protection("effective", [{ ordId: "202" }]));
    expect(await collectOkxDemoOrderEvidence(wrongIds, journal)).toMatchObject({ reason: "invalid_spawned_order_ids" });
    const empty = setup(); empty.privateGetTradeOrderAlgo.mockResolvedValue(protection("effective", []));
    expect(await collectOkxDemoOrderEvidence(empty, journal)).toMatchObject({ reason: "effective_order_without_spawned_order" });
  });
  it("preserves live status and fails closed on API errors", async () => {
    const live = setup(); live.privateGetTradeOrderAlgo.mockResolvedValue(protection("live", [])); live.privateGetTradeOrder.mockResolvedValue(order("101", "buy", "partially_filled"));
    const result = await collectOkxDemoOrderEvidence(live, journal);
    expect(result.status).toBe("collected");
    if (result.status === "collected") expect(result.orders[0]?.terminal).toBe(false);
    const error = setup(); error.privateGetTradeOrder.mockRejectedValue(new Error("offline"));
    expect(await collectOkxDemoOrderEvidence(error, journal)).toMatchObject({ reason: "order_evidence_request_failed" });
  });
});

it('reuses a checkpoint-proven terminal buy but always reads live protection and spawned sells', async () => {
  const client=setup();
  const first=await collectOkxDemoOrderEvidence(client,journal);
  if(first.status!=='collected')throw Error('fixture');
  const parent={order:first.buys[0]!,evidence:first.orders.find(o=>o.id==='101')!};
  client.privateGetTradeOrder.mockClear();
  client.privateGetTradeOrder.mockImplementation(async params=>{if(params.ordId==='101')throw Error('expired parent history');return order('202','sell')});
  expect((await collectOkxDemoOrderEvidence(client,journal,[parent])).status).toBe('collected');
  expect(client.privateGetTradeOrder).not.toHaveBeenCalledWith(expect.objectContaining({ordId:'101'}));
  expect(client.privateGetTradeOrderAlgo).toHaveBeenCalledWith({algoClOrdId:'AP1'});
  expect(client.privateGetTradeOrder).toHaveBeenCalledWith(expect.objectContaining({ordId:'202'}));
  expect(await collectOkxDemoOrderEvidence(client,journal,[{...parent,order:{...parent.order,clientOrderId:'different'}}])).toMatchObject({reason:'invalid_cached_parent'});
  client.privateGetTradeOrderAlgo.mockRejectedValueOnce(Error('protection unavailable'));
  expect(await collectOkxDemoOrderEvidence(client,journal,[parent])).toMatchObject({status:'unavailable'});
});
