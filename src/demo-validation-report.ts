import { z } from "zod";

const HOUR_MS = 3_600_000;
const WINDOW_MS = 48 * HOUR_MS;
const detailsSchema = z.record(z.string(), z.unknown());
const rowSchema = z.object({
  section: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }).optional(),
  client_order_id: z.string().optional(),
  symbol: z.string().nullish(),
  event_type: z.string().optional(),
  severity: z.string().optional(),
  status: z.string().optional(),
  details: detailsSchema.nullish(),
  result: detailsSchema.nullish(),
});
const exportSchema = z.object({
  generatedAt: z.iso.datetime({ offset: true }),
  scope: z.object({
    hours: z.number().int().positive().max(2160),
    maxRowsPerSection: z.number().int().positive().max(500),
    sectionsAtLimit: z.array(z.string()).optional(),
  }),
  records: z.array(rowSchema),
});
type Row = z.infer<typeof rowSchema>;

export function summarizeDemoValidation(startUtc: string, inputs: unknown[]) {
  const start = Date.parse(z.iso.datetime().parse(startUtc));
  if (!inputs.length) throw new Error("Provide at least one diagnostic export");
  const end = start + WINDOW_MS;
  const exports = inputs.map(item => exportSchema.parse(item))
    .sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
  const capturedThrough = Date.parse(exports.at(-1)!.generatedAt);
  const events = new Map<string, Row>();
  const orders = new Map<string, Row>();
  const skippedOrderSnapshots = new Set<string>();
  const requiredSections = ["operational_events", "demo_orders"];
  const coverage = Object.fromEntries(requiredSections.map(section => [section, coverageFor(section)]));

  for (const input of exports) {
    const generated = Date.parse(input.generatedAt);
    for (const row of input.records) {
      const created = Date.parse(row.created_at);
      if (created < start || created >= end || created > generated) continue;
      if (row.section === "operational_events") {
        events.set(JSON.stringify(row), row);
      } else if (row.section === "demo_orders") {
        const identity = row.client_order_id || stringValue(row.result?.clientOrderId);
        const observed = row.updated_at ? Date.parse(row.updated_at) : generated;
        if (!identity || observed >= end || observed > generated) {
          skippedOrderSnapshots.add(identity ?? JSON.stringify([row.symbol, row.created_at, row.status]));
          continue;
        }
        const existing = orders.get(identity);
        const priorUpdated = existing?.updated_at && Date.parse(existing.updated_at);
        if (!priorUpdated || observed >= priorUpdated) orders.set(identity, row);
      }
    }
  }
  const operational = [...events.values()];
  const byEvent = countBy(operational, row => row.event_type);
  const decisions = operational.filter(row => row.event_type === "DEMO_ENTRY_DECISION");
  const protection = operational.filter(row => row.event_type === "DEMO_ENTRY_PROTECTION");
  const proven = new Set(protection.filter(row => row.details?.verified === true).map(row => stringValue(row.details?.clientOrderId)));
  const confirmed = [...orders].filter(([, row]) => row.status === "PLACED" && row.result?.confirmed === true &&
    typeof row.result.filled === "number" && row.result.filled > 0);
  const marketChecks = operational.filter(row => row.event_type === "ENTRY_MARKET_CHECK");
  const executionSpreadRejections = decisions.filter(row => row.details?.stage === "execution" && row.details.reason === "demo_spread_exceeded");
  const issues = operational.filter(row => row.severity === "ERROR" || row.event_type === "DEMO_PROTECTION_BLOCKED" ||
    (row.event_type === "DEMO_ENTRY_PROTECTION" && row.details?.verified === false));

  return {
    window: { startUtc: new Date(start).toISOString(), endExclusiveUtc: new Date(end).toISOString(),
      capturedThroughUtc: new Date(capturedThrough).toISOString(),
      status: capturedThrough < end ? "in_progress" : Object.values(coverage).every(item => item.uncoveredMinutes === 0) ? "export_range_covered" : "incomplete_exports",
      coverage },
    operational: { byEvent, markets: countBy(operational, row => row.symbol),
      restarts: byEvent.SERVICE_RESTARTED ?? 0, pauses: countBy(operational.filter(row =>
        row.event_type === "BOT_PAUSED" && row.details?.paused === true), row => stringValue(row.details?.actor)),
      criticalEvidence: countBy(issues, row => row.event_type) },
    entry: { attempts: byEvent.DEMO_ENTRY_ATTEMPT ?? 0,
      rejectionReasons: countBy(decisions.filter(row => row.details?.approved === false), row => stringValue(row.details?.reason)),
      sharedMarketChecks: { count: marketChecks.length, spreadsPercent: spreadSummary(marketChecks) },
      executionSpreadRejections: { count: executionSpreadRejections.length, spreadsPercent: spreadSummary(executionSpreadRejections) } },
    executionAssessment: {
      status: confirmed.length ? "fills_observed" : "no_confirmed_fills",
      operationalValidationPassed: confirmed.length > 0 && confirmed.every(([identity]) => proven.has(identity)) && issues.length === 0 && Object.values(coverage).every(item => item.uncoveredMinutes === 0) && capturedThrough >= end,
      blockersObserved: countBy(decisions.filter(row => row.details?.approved === false), row => stringValue(row.details?.reason)),
      conclusion: confirmed.length ? "Inspect coverage, protections and errors before accepting the operational test." : "No confirmed fills: order execution and protections were not validated. This does not prove absence of exchange trades or identify a single root cause.",
    },
    orders: { observed: orders.size, byStatus: countBy(orders.values(), row => row.status),
      confirmedFills: confirmed.length, confirmedFillsWithVerifiedEntryProtection: confirmed.filter(([identity]) => proven.has(identity)).length,
      verifiedEntryProtectionEvents: protection.filter(row => row.details?.verified === true).length,
      reconciledInWindow: [...orders.values()].filter(row => {
        const value = stringValue(row.result?.reconciledAt);
        const at = value ? Date.parse(value) : NaN;
        return row.status !== "PENDING" && at >= start && at < end;
      }).length, omittedOrderSnapshots: skippedOrderSnapshots.size },
    limitations: [
      "Coverage reflects export limits and timestamps. It does not prove worker uptime, deployment identity, prior data retention or exchange-side activity.",
      "Order rows are last observed snapshots inside the window. A lack of confirmed fills leaves execution and protection inconclusive.",
    ],
  };

  function coverageFor(section: string) {
    let cursor = start;
    let uncovered = 0;
    let cappedExports = 0;
    const ranges: Array<{ from: number; to: number }> = [];
    for (const item of exports) {
      const to = Date.parse(item.generatedAt);
      const from = to - item.scope.hours * HOUR_MS;
      if (to <= start || from >= end) continue;
      const count = item.records.filter(row => row.section === section).length;
      if (count >= item.scope.maxRowsPerSection || item.scope.sectionsAtLimit?.includes(section)) {
        cappedExports++;
        continue;
      }
      ranges.push({ from, to });
    }
    ranges.sort((a, b) => a.from - b.from);
    for (const { from, to } of ranges) {
      if (to <= cursor) continue;
      uncovered += Math.max(0, from - cursor);
      cursor = Math.min(to, end);
    }
    return { uncoveredMinutes: (uncovered + end - cursor) / 60_000, cappedExports };
  }
}

function countBy<T>(items: Iterable<T>, keyOf: (item: T) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function spreadSummary(rows: Row[]) {
  const values = rows.flatMap(row => {
    const value = row.details?.spreadPercent;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? [value] : [];
  });
  return { measured: values.length, max: values.length ? Math.max(...values) : null };
}
