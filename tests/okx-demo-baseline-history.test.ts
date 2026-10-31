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
    const client = (data: unknown) => ({ privateGetAccountBills: async () => ({ code: "0", data }) });
    await expect(inspectBaselineBills(client([{ ts: String(window.from) }]), window)).resolves.toEqual({ status: "observed", activity: true });
    await expect(inspectBaselineBills(client([{ ts: String(window.to + 1) }]), window)).resolves.toMatchObject({ reason: "baseline_history_outside_window" });
    await expect(inspectBaselineBills(client([{}]), window)).resolves.toMatchObject({ reason: "invalid_baseline_history_record" });
    await expect(inspectBaselineBills(client([]), { ...window, from: now - 7 * 86_400_000 })).resolves.toMatchObject({ reason: "baseline_history_window_unsupported" });
  });
});
