import { describe, expect, it } from "vitest";
import { verifyDemoOwnership, type JournaledDemoBuy, type ExchangeDemoOrder, type ExchangeProtection } from "../src/demo-ownership.js";

const journal: JournaledDemoBuy[] = [{ orderId: "buy1", clientOrderId: "bot1", symbol: "BTC/USDT", attachedAlgoClientId: "algo1" }];
const buys: ExchangeDemoOrder[] = [{ id: "buy1", clientOrderId: "bot1", symbol: "BTC/USDT", side: "buy", attachedAlgoClientIds: ["algo1"] }];
const protections: ExchangeProtection[] = [{ algoClientId: "algo1", symbol: "BTC/USDT", side: "sell", spawnedOrderIds: ["stop1", "stop2"] }];
const sells: ExchangeDemoOrder[] = [{ id: "stop1", clientOrderId: null, symbol: "BTC/USDT", side: "sell" }, { id: "stop2", clientOrderId: null, symbol: "BTC/USDT", side: "sell" }];

describe("Demo order ownership", () => {
  it("links split protective exits only through the journaled algo id", () => {
    expect(verifyDemoOwnership(journal, buys, protections, sells)).toEqual({ status: "confirmed", ownedOrderIds: ["buy1", "stop1", "stop2"] });
  });
  it("rejects legacy entries without an attachment id and unrelated sales", () => {
    expect(verifyDemoOwnership([{ ...journal[0]!, attachedAlgoClientId: null }], buys, protections, sells)).toMatchObject({ reason: "missing_or_duplicate_protection_identity" });
    expect(verifyDemoOwnership(journal, buys, protections, [...sells, { ...sells[0]!, id: "manual" }])).toMatchObject({ reason: "unattributed_sell" });
  });
  it("rejects identity mismatches and ambiguous exchange records", () => {
    expect(verifyDemoOwnership(journal, [{ ...buys[0]!, clientOrderId: "other" }], protections, sells)).toMatchObject({ reason: "buy_identity_mismatch" });
    expect(verifyDemoOwnership(journal, [{ ...buys[0]!, attachedAlgoClientIds: [] }], protections, sells)).toMatchObject({ reason: "parent_attachment_unconfirmed" });
    expect(verifyDemoOwnership(journal, buys, [...protections, protections[0]!], sells)).toMatchObject({ reason: "protection_identity_unconfirmed" });
    expect(verifyDemoOwnership(journal, buys, protections, [{ ...sells[0]!, symbol: "ETH/USDT" }, sells[1]!])).toMatchObject({ reason: "spawned_order_unconfirmed" });
  });
});
