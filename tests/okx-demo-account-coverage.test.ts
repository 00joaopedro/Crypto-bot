import { describe, expect, it, vi } from "vitest";
import { collectDemoAccountCoverage } from "../src/okx-demo-account-coverage.js";

const now = 1_800_000_000_000;
const input = { from: now - 1000, to: now, now, ownedOrderIds: new Set(["buy1"]) };
const bill = (id: string, ordId = "buy1") => ({ billId: id, ordId, ts: String(now - 500) });
describe("bounded Demo account history coverage", () => {
  it("reads every page and counts only attributed movements", async () => {
    const request = vi.fn(async (params: Record<string, string>) => ({ code: "0", data: params.after ? [] : [bill("9"), bill("8")] }));
    expect(await collectDemoAccountCoverage({ privateGetAccountBills: request }, input)).toEqual({ status: "covered", billCount: 2 });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ after: "8" }));
  });
  it("rejects an unknown account movement, stale window, and pagination cutoff", async () => {
    expect(await collectDemoAccountCoverage({ privateGetAccountBills: async () => ({ code: "0", data: [bill("9")] }) }, { ...input, quiescentFrom: now - 600 })).toMatchObject({ reason: "account_movement_during_snapshot" });
    expect(await collectDemoAccountCoverage({ privateGetAccountBills: async () => ({ code: "0", data: [bill("9", "manual")] }) }, input)).toMatchObject({ reason: "unattributed_account_bill" });
    expect(await collectDemoAccountCoverage({ privateGetAccountBills: async () => ({ code: "0", data: [] }) }, { ...input, from: now - 7 * 86_400_000 })).toMatchObject({ reason: "account_coverage_window_unsupported" });
    expect(await collectDemoAccountCoverage({ privateGetAccountBills: async () => ({ code: "0", data: [bill("9")] }) }, { ...input, maxPages: 1 })).toMatchObject({ reason: "account_bills_page_limit" });
    expect(await collectDemoAccountCoverage({ privateGetAccountBills: async () => ({ code: "0", data: [bill("9")] }) }, input)).toMatchObject({ reason: "account_bills_cursor_invalid" });
  });
});

it('covers a gap longer than six days using historical bills and refuses missing history', async () => {
  const boundary = now - 6 * 86400000;
  const historical = vi.fn(async (params: Record<string,string>) => ({ code: '0', data: params.after ? [] : [{ billId: '1', ordId: 'buy1', ts: String(boundary-1) }] }));
  const recent = vi.fn(async (params: Record<string,string>) => ({ code: '0', data: params.after ? [] : [{ billId: '2', ordId: 'buy1', ts: String(boundary) }] }));
  expect(await collectDemoAccountCoverage({ privateGetAccountBills: recent, privateGetAccountBillsHistory: historical }, { ...input, from: now-10*86400000 })).toEqual({ status: 'covered', billCount: 2 });
  expect(historical).toHaveBeenCalledWith(expect.objectContaining({ end: String(boundary-1) }));
  expect(recent).toHaveBeenCalledWith(expect.objectContaining({ begin: String(boundary) }));
  expect(await collectDemoAccountCoverage({ privateGetAccountBills: recent, privateGetAccountBillsHistory: async () => { throw Error('unavailable'); } }, { ...input, from: now-10*86400000 })).toMatchObject({ status: 'unavailable' });
});
