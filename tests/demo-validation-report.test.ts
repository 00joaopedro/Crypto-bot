import { describe, expect, it } from "vitest";
import { summarizeDemoValidation } from "../src/demo-validation-report.js";

const start = "2026-11-17T00:00:00Z";
const mid = "2026-11-18T00:00:00Z";
const end = "2026-11-19T00:00:00Z";
const at = "2026-11-17T22:00:00Z";
const order = {
  section: "demo_orders", created_at: at, updated_at: at, symbol: "BTC/USDT",
  client_order_id: "TEST-ID", status: "PENDING", result: { confirmed: false },
};
const placed = {
  ...order, updated_at: mid, status: "PLACED",
  result: { confirmed: true, filled: 0.01, reconciledAt: mid },
};
const protection = {
  section: "operational_events", created_at: mid, symbol: "BTC/USDT", event_type: "DEMO_ENTRY_PROTECTION",
  details: { clientOrderId: "TEST-ID", verified: true },
};
const book = {
  section: "operational_events", created_at: at, symbol: "BTC/USDT", event_type: "ENTRY_MARKET_CHECK",
  details: { allowed: true, spreadPercent: 0.03 },
};
const capture = (generatedAt: string, hours: number, records: unknown[] = [], sectionsAtLimit: string[] = []) =>
  ({ generatedAt, scope: { hours, maxRowsPerSection: 500, sectionsAtLimit }, records });

describe("Demo validation report", () => {
  it("merges overlaps, materializes the latest order snapshot and links the entry protection", () => {
    const report = summarizeDemoValidation(start, [
      capture(mid, 24, [book, order]),
      capture(end, 48, [book, placed, protection]),
    ]);
    expect(report.window.status).toBe("export_range_covered");
    expect(report.entry.sharedMarketChecks).toEqual({ count: 1, spreadsPercent: { measured: 1, max: 0.03 } });
    expect(report.orders).toMatchObject({
      observed: 1, byStatus: { PLACED: 1 }, confirmedFills: 1, confirmedFillsWithVerifiedEntryProtection: 1,
      reconciledInWindow: 1,
    });
    expect(JSON.stringify(report)).not.toContain("TEST-ID");
  });

  it("does not use reconciliation after the cutoff or count an empty report as execution evidence", () => {
    const report = summarizeDemoValidation(start, [
      capture(mid, 24, [order]),
      capture("2026-11-19T01:00:00Z", 48, [{ ...placed, updated_at: end }]),
    ]);
    expect(report.orders.byStatus).toEqual({ PENDING: 1 });
    expect(report.orders.confirmedFills).toBe(0);
    expect(report.orders.omittedOrderSnapshots).toBe(1);
    expect(report.orders.reconciledInWindow).toBe(0);
  });

  it("marks saturated sections as incomplete and accepts a later overlapping export that fills the gap", () => {
    const capped = capture(mid, 24, [], ["operational_events"]);
    const later = capture(end, 24);
    const incomplete = summarizeDemoValidation(start, [capped, later]);
    expect(incomplete.window.status).toBe("incomplete_exports");
    expect(incomplete.window.coverage.operational_events).toEqual({ uncoveredMinutes: 1440, cappedExports: 1 });
    expect(incomplete.window.coverage.demo_orders?.uncoveredMinutes).toBe(0);
    const complete = summarizeDemoValidation(start, [capped, later, capture("2026-11-19T01:00:00Z", 49)]);
    expect(complete.window.status).toBe("export_range_covered");
  });

  it("reports partial time and distinguishes missing numeric spread from zero", () => {
    const report = summarizeDemoValidation(start, [capture(mid, 24, [
      { ...book, details: { allowed: false, reason: "demo_book_unavailable" } },
      { ...book, event_type: "DEMO_ENTRY_DECISION",
        details: { approved: false, stage: "execution", reason: "demo_spread_exceeded", spreadPercent: 0.24 } },
      { ...book, event_type: "DEMO_PROTECTION_BLOCKED", severity: "WARN" },
    ])]);
    expect(report.window.status).toBe("in_progress");
    expect(report.entry.sharedMarketChecks.spreadsPercent).toEqual({ measured: 0, max: null });
    expect(report.entry.executionSpreadRejections.spreadsPercent.max).toBe(0.24);
    expect(report.operational.criticalEvidence).toEqual({ DEMO_PROTECTION_BLOCKED: 1 });
  });
});
