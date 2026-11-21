import { describe, expect, it } from "vitest";
import { diagnoseClosedTrades, type DiagnosticTrade } from "../src/strategy-diagnostics.js";
import { diagnosePaperExport, diagnosePortfolioReport } from "../src/strategy-diagnostic-input.js";

const trade = (changes: Partial<DiagnosticTrade> = {}): DiagnosticTrade => ({ symbol: "BTC/USDT", entryTimestamp: 900000, exitTimestamp: 1800000,
  entryPrice: 10, exitPrice: 10.1, quantity: 1, feesUsdt: .2, netPnlUsdt: -.1, reason: "TRAILING_STOP", ...changes });
describe("explanatory strategy diagnostics", () => {
  it("separates filled-price P&L from fees without subtracting slippage twice", () => {
    const report = diagnoseClosedTrades([trade(), trade({ symbol: "ETH/USDT", exitPrice: 9.8, netPnlUsdt: -.4, reason: "STOP_LOSS" })]);
    expect(report.summary).toMatchObject({ closedTrades: 2, feeTurnedLosses: 1, losses: 2, profitFactor: 0 });
    expect(report.summary.beforeFeesPnlUsdt).toBeCloseTo(-.1);
    expect(report.summary.feesUsdt).toBeCloseTo(.4);
    expect(report.summary.realizedPnlUsdt).toBeCloseTo(-.5);
    expect(report.summary.meanNetReturnBps).toBeCloseTo(-250);
    expect(report.summary.meanHoldingMinutes).toBe(15);
    expect(report.summary.breakEvenWinRatePercent).toBeNull();
    expect(report.warnings.join(" ")).toMatch(/negative even before/);
  });
  it("preserves unknown entry evidence and original configuration, not current values", () => {
    const report = diagnoseClosedTrades([trade(), trade({ symbol: "ETH/USDT", configurationHash: "a".repeat(64), entryContext: { decisionTimestamp: 0, rsi14: 63, btcState: "allowed" } })]);
    expect(report.byEntryRsi.map(g => g.key)).toEqual(["above55to63", "unknown"]);
    expect(report.byConfiguration.map(g => g.key)).toContain("unattributed");
    expect(report.byConfiguration.map(g => g.key)).toContain("a".repeat(64));
    expect(report.byBtcEntryState.map(g => g.key)).toEqual(["allowed", "unknown"]);
  });
  it("does not invent infinite profit factor or expectancy for empty/no-loss samples", () => {
    expect(diagnoseClosedTrades([]).summary).toMatchObject({ closedTrades: 0, profitFactor: null, expectancyUsdt: null });
    const report = diagnoseClosedTrades([trade({ exitPrice: 11, netPnlUsdt: .8 })]);
    expect(report.summary.profitFactor).toBeNull();
    expect(report.summary.realizedPnlWithoutTop3Usdt).toBeCloseTo(0);
    expect(report.summary.top3TradesProfitSharePercent).toBe(100);
  });
  it("deduplicates exact closes but rejects conflicting records and inconsistent accounting", () => {
    expect(diagnoseClosedTrades([trade(), trade()])).toMatchObject({ duplicateRowsIgnored: 1, summary: { closedTrades: 1 } });
    expect(() => diagnoseClosedTrades([trade(), trade({ reason: "STOP_LOSS" })])).toThrow(/Conflicting duplicate/);
    expect(() => diagnoseClosedTrades([trade({ netPnlUsdt: 10 })])).toThrow(/reconcile/);
    expect(() => diagnoseClosedTrades([trade({ quantity: Number.NaN })])).toThrow();
    expect(() => diagnoseClosedTrades([trade({ exitTimestamp: 0 })])).toThrow(/chronology/);
    expect(() => diagnoseClosedTrades([trade({ entryContext: { decisionTimestamp: 900001, rsi14: 70 } })])).toThrow(/chronology/);
  });
  it("joins only exact Paper entry decisions, flags caps and excludes Demo responses", () => {
    const closed = { section: "paper_trades", symbol: "BTC/USDT", event_type: "CLOSED", trade: { type: "CLOSED", ...trade() } };
    const decision = { section: "decisions", symbol: "BTC/USDT", candle_timestamp: "900000", signal: { candleTimestamp: 900000, rsi14: 69, score: 7 } };
    const report = diagnosePaperExport({ scope: { sectionsAtLimit: ["decisions"] }, records: [closed, closed, decision,
      { ...decision, symbol: "ETH/USDT", signal: { ...decision.signal, rsi14: 20 } },
      { section: "demo_orders", result: { netPnlUsdt: 100 } },
      { section: "paper_trades", event_type: "OPENED", trade: { type: "OPENED" } },
    ] });
    expect(report.summary.closedTrades).toBe(1);
    expect(report.byEntryRsi[0]?.key).toBe("above63to70");
    expect(report.coverage).toMatchObject({ ignoredNonClosedPaperRows: 1, sectionsAtLimit: ["decisions"] });
    expect(report.sourceLimitations.join(" ")).toMatch(/truncated/);
    const ambiguous = diagnosePaperExport({ records: [closed, decision, { ...decision, signal: { ...decision.signal, rsi14: 60 } }] });
    expect(ambiguous.byEntryRsi[0]?.key).toBe("unknown");
    expect(ambiguous.coverage.ambiguousEntryDecisions).toBe(1);
  });
  it("keeps replay scenarios separate and refuses aggregate-only legacy reports", () => {
    const result = { closedTradeLedger: [trade()] };
    const report = diagnosePortfolioReport({ status: "exploratory_simulation_only", results: [
      { size: 15, scenarios: [{ scenario: { name: "standard" }, result }, { scenario: { name: "stress" }, result }] },
    ] });
    expect(report.runs).toHaveLength(2);
    expect(report.runs.every(run => run.summary.closedTrades === 1)).toBe(true);
    expect(() => diagnosePortfolioReport({ status: "simulation_only", results: [{ scenario: { name: "base" }, result: { closedTrades: 5 } }] })).toThrow();
  });
});
