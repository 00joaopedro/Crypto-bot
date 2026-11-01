import { describe, expect, it, vi } from "vitest";
import { collectOkxDemoFills, type OkxFillHistoryClient } from "../src/okx-demo-fill-history.js";

const day = 86_400_000;
const now = 200 * day;
const from = now - day;
const row = (id: string) => ({ billId: id, instType: "SPOT", instId: "BTC-USDT", ordId: "order", side: "buy", fillSz: "0.5", fillPx: "100", fee: "-0.1", feeCcy: "USDT", fillTime: String(from + 1), ts: String(from + 2) });
const options = { symbol: "BTC/USDT", from, to: now, now };
const client = (recent: OkxFillHistoryClient["privateGetTradeFills"]): OkxFillHistoryClient => ({ privateGetTradeFills: recent, privateGetTradeFillsHistory: async () => ({ code: "0", data: [] }) });

describe("OKX Demo fill history collector", () => {
  it("paginates using billId until an empty page and normalizes fees", async () => {
    const request = vi.fn().mockResolvedValueOnce({ code: "0", data: [row("8"), row("7")] }).mockResolvedValueOnce({ code: "0", data: [row("6")] }).mockResolvedValueOnce({ code: "0", data: [] });
    const result = await collectOkxDemoFills(client(request), options);
    expect(result.status).toBe("collected");
    if (result.status === "collected") expect(result.fills[0]).toMatchObject({ id: "8", orderId: "order", amount: 0.5, costUsdt: 50, fees: [{ currency: "USDT", cost: 0.1 }] });
    expect(request.mock.calls[1]?.[0].after).toBe("7");
    expect(request.mock.calls[2]?.[0].after).toBe("6");
  });
  it("fails closed on cursor regression, missing fee, rebate, and page limit", async () => {
    for (const data of [[row("7"), row("8")], [{ ...row("7"), fee: "" }], [{ ...row("7"), fee: "0.1" }]]) {
      expect((await collectOkxDemoFills(client(async () => ({ code: "0", data })), options)).status).toBe("unavailable");
    }
    expect(await collectOkxDemoFills(client(async () => ({ code: "0", data: [row("7")] })), { ...options, maxPages: 1 })).toMatchObject({ reason: "history_page_limit_exceeded" });
  });
  it("rejects unsupported old windows and failed requests", async () => {
    expect(await collectOkxDemoFills(client(async () => ({ code: "0", data: [] })), { ...options, from: now - 81 * day })).toMatchObject({ reason: "invalid_or_unsupported_history_window" });
    expect(await collectOkxDemoFills(client(async () => { throw new Error("network"); }), options)).toMatchObject({ reason: "history_request_failed" });
  });
  it("deduplicates the overlap and rejects conflicting versions", async () => {
    const overlap = { ...row("8"), fillTime: String(now - 1.5 * day), ts: String(now - 1.5 * day) };
    const mock = (record: object) => vi.fn().mockResolvedValueOnce({ code: "0", data: [record] }).mockResolvedValueOnce({ code: "0", data: [] });
    const input = { ...options, from: now - 3 * day };
    const collected = await collectOkxDemoFills({ privateGetTradeFills: mock(overlap), privateGetTradeFillsHistory: mock(overlap) }, input);
    expect(collected.status === "collected" && collected.fills.length).toBe(1);
    expect(await collectOkxDemoFills({ privateGetTradeFills: mock(overlap), privateGetTradeFillsHistory: mock({ ...overlap, fee: "-0.2" }) }, input)).toMatchObject({ reason: "conflicting_fill_records" });
  });
});
