import { z } from "zod";
import { diagnoseClosedTrades, diagnosticTradeSchema, type EntryDiagnosticContext } from "./strategy-diagnostics.js";

const object = z.record(z.string(), z.unknown());
const recordsSchema = z.object({ records: z.array(object), scope: z.object({
  hours: z.number().finite().positive().optional(), sectionsAtLimit: z.array(z.string()).optional(),
}).passthrough().optional() }).passthrough();

export function diagnosePaperExport(input: unknown) {
  const exported = recordsSchema.parse(input);
  const contexts = new Map<string, EntryDiagnosticContext | null>();
  let ignoredNonClosedPaperRows = 0;
  for (const row of exported.records) {
    if (row.section !== "decisions") continue;
    const signal = object.safeParse(row.signal);
    if (!signal.success) continue;
    const symbol = z.string().parse(row.symbol);
    const ts = z.coerce.number().int().nonnegative().safe().parse(row.candle_timestamp);
    const parsed = z.object({ candleTimestamp: z.number().int().nonnegative().safe(), rsi14: z.number().finite().min(0).max(100), score: z.number().finite().min(0).max(8) }).safeParse(signal.data);
    if (!parsed.success || parsed.data.candleTimestamp !== ts) continue;
    const context = { decisionTimestamp: ts, rsi14: parsed.data.rsi14, score: parsed.data.score };
    const key = `${symbol}:${ts}`;
    if (contexts.has(key) && JSON.stringify(contexts.get(key)) !== JSON.stringify(context)) contexts.set(key, null);
    else contexts.set(key, context);
  }
  const trades = exported.records.flatMap(row => {
    if (row.section !== "paper_trades") return [];
    const trade = object.parse(row.trade);
    if (row.event_type !== "CLOSED") { ignoredNonClosedPaperRows++; return []; }
    if (trade.type !== "CLOSED") throw new Error("Paper row/type mismatch");
    const symbol = z.string().parse(row.symbol);
    const key = `${symbol}:${trade.entryTimestamp}`;
    return [diagnosticTradeSchema.parse({ symbol,
      entryTimestamp: trade.entryTimestamp, exitTimestamp: trade.exitTimestamp, entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice, quantity: trade.quantity, feesUsdt: trade.feesUsdt, netPnlUsdt: trade.netPnlUsdt,
      reason: trade.reason, ...(trade.configurationHash !== undefined ? { configurationHash: trade.configurationHash } : {}),
      ...(contexts.get(key) ? { entryContext: contexts.get(key) } : {}),
    })];
  });
  return {
    source: "paper_export", ...diagnoseClosedTrades(trades),
    coverage: { exportedRecords: exported.records.length, ignoredNonClosedPaperRows,
      sectionsAtLimit: exported.scope?.sectionsAtLimit ?? [],
      ambiguousEntryDecisions: [...contexts.values()].filter(v => v === null).length },
    sourceLimitations: [
      "Paper events only. Demo order responses are deliberately excluded: they are not reconciled closed round trips.",
      "Export selection is based on database creation time, not necessarily trade time. Replay versus forward execution is not reliably identified in these rows.",
      "Missing or conflicting exact entry decisions remain unknown. Current configuration and decisions from another pair/candle are never substituted.",
      ...(exported.scope?.sectionsAtLimit?.length ? ["At least one export section reached its row cap; the sample can be truncated."] : []),
    ],
  };
}

const replayResult = z.object({ closedTradeLedger: z.array(diagnosticTradeSchema) }).passthrough();
const scenario = z.object({ name: z.string().min(1), feeRate: z.number().finite().min(0).lt(1).optional(),
  slippageRate: z.number().finite().min(0).lt(1).optional(), spreadRate: z.number().finite().min(0).lt(1).optional() });
/** Supported complete reports only. Reject older aggregate-only summaries instead of inventing trades. */
export function diagnosePortfolioReport(input: unknown) {
  const report = object.parse(input);
  if (report.status !== "simulation_only" && report.status !== "exploratory_simulation_only") throw new Error("Expected a portfolio simulation report");
  const runs: Array<{ universeSize?: number; variant?: string; scenario: z.infer<typeof scenario>; result: z.infer<typeof replayResult> }> = [];
  for (const item of z.array(object).parse(report.results)) {
    if (Array.isArray(item.scenarios)) {
      const size = z.number().int().nonnegative().parse(item.size);
      for (const s of z.array(object).parse(item.scenarios)) runs.push({ universeSize: size, scenario: scenario.parse(s.scenario), result: replayResult.parse(s.result) });
    } else if (Array.isArray(item.variants)) {
      for (const v of z.array(object).parse(item.variants)) runs.push({ variant: z.string().parse(v.name), scenario: scenario.parse(item.scenario), result: replayResult.parse(v) });
    } else runs.push({ scenario: scenario.parse(item.scenario), result: replayResult.parse(item.result) });
  }
  if (!runs.length) throw new Error("No diagnostic runs found");
  return {
    status: "descriptive_simulation_only", source: "portfolio_report",
    runs: runs.map(({ result, scenario, ...identity }) => ({ ...identity, scenario: scenario.name,
      assumedCosts: { feeRate: scenario.feeRate ?? null, slippageRate: scenario.slippageRate ?? null, spreadRate: scenario.spreadRate ?? null },
      ...diagnoseClosedTrades(result.closedTradeLedger) })),
    limitations: [
      "Each scenario/universe/variant is diagnosed separately. Repeated trades across runs are not pooled as independent observations.",
      "This reuses already inspected historical data for explanation, not a new independent holdout or a parameter search. Costs and fills remain simulated.",
      "Complete closed-trade ledgers are required. Older aggregate-only reports must be reproduced from their frozen datasets; top winners alone cannot reconstruct losses.",
    ],
  };
}
