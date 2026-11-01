import { describe, expect, it, vi } from "vitest";
import { inspectBaselineBills } from "../src/okx-demo-baseline-history.js";

describe("baseline account bill observation", () => {
  const now = 1_800_000_000_000;
  const window = { from: now - 1000, to: now - 500, now };
  it("accepts an empty response as an observation, not proof", async () => {
    const request = vi.fn(async () => ({ code: "0", data: [] }));
    await expect(inspectBaselineBills({ privateGetAccountBills: request }, window)).resolves.toEqual({ status: "observed", activity: false });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ begin: String(window.from - 1), end: String(window.to + 1) }));
  });
  it("detects activity and rejects malformed or out-of-window records", async () => {
    const client = (data: unknown) => ({ privateGetAccountBills: async (params: Record<string, string>) => ({ code: "0", data: params.after ? [] : data }) });
    await expect(inspectBaselineBills(client([{ billId: "9", ts: String(window.from) }]), window)).resolves.toEqual({ status: "observed", activity: true });
    await expect(inspectBaselineBills(client([{ billId: "9", ts: String(window.to + 1) }]), window)).resolves.toMatchObject({ reason: "baseline_history_outside_window" });
    await expect(inspectBaselineBills(client([{}]), window)).resolves.toMatchObject({ reason: "invalid_baseline_history_record" });
    await expect(inspectBaselineBills(client([]), { ...window, from: now - 7 * 86_400_000 })).resolves.toMatchObject({ reason: "baseline_history_window_unsupported" });
  });
  it("does not report an empty history when the exchange returns an error or oversized page", async () => {
    await expect(inspectBaselineBills({ privateGetAccountBills: async () => ({ code: "50001", data: [] }) }, window)).resolves.toMatchObject({ status: "unavailable", reason: "invalid_baseline_history_response" });
    await expect(inspectBaselineBills({ privateGetAccountBills: async () => ({ code: "0", data: Array(101).fill({ ts: String(window.from) }) }) }, window)).resolves.toMatchObject({ status: "unavailable", reason: "invalid_baseline_history_response" });
    await expect(inspectBaselineBills({ privateGetAccountBills: async () => { throw new Error("network"); } }, window)).resolves.toMatchObject({ status: "unavailable", reason: "baseline_history_request_failed" });
  });
  it("paginates by bill ID and refuses repeated cursors or truncated history", async () => {
    const request = vi.fn(async (params: Record<string, string>) => ({ code: "0", data: params.after === "8" ? [] : [{ billId: "9", ts: String(window.from) }, { billId: "8", ts: String(window.from) }] }));
    await expect(inspectBaselineBills({ privateGetAccountBills: request }, window)).resolves.toEqual({ status: "observed", activity: true });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ after: "8" }));
    await expect(inspectBaselineBills({ privateGetAccountBills: async () => ({ code: "0", data: [{ billId: "9", ts: String(window.from) }] }) }, { ...window, maxPages: 1 })).resolves.toMatchObject({ reason: "baseline_history_page_limit" });
    await expect(inspectBaselineBills({ privateGetAccountBills: async () => ({ code: "0", data: [{ billId: "9", ts: String(window.from) }] }) }, window)).resolves.toMatchObject({ reason: "non_monotonic_baseline_bills" });
  });
});
