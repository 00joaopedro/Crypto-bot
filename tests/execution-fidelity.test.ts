import type { TradingTerms } from '../src/execution-fidelity.js';
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import { effectiveExecutionSnapshot, executionFidelityReport, validateExecutionSnapshot, TradingTermsCache } from "../src/execution-fidelity.js";
import { PaperTrader } from "../src/paper-trader.js";
import { exitPolicySchema } from "../src/exit-policy.js";
const settings = { symbol: "BTC/USDT", orderSizeUsdt: 10, paperTradeSizeUsdt: null, maxConcurrentPositions: 10, maxTrades: 10, intervalMinutes: 15 };
const unknownFee = { status: "unavailable" as const, reason: "fee_unconfirmed" as const };
const study = JSON.parse(readFileSync(new URL("../examples/universe-validation.study.json", import.meta.url), "utf8"));
it("compares the active Paper altcoin cap rather than a dormant configured value", () => {
  const report = (enabled: boolean, rate: number) => executionFidelityReport(effectiveExecutionSnapshot(parseConfig({
    RISK_SIZING_ENABLED: String(enabled), RISK_MAX_ALT_EXPOSURE_PERCENT: String(rate),
  }), settings, undefined), unknownFee, study);
  const offMatching = report(false, .1).findings.find(f => f.id === "alt_exposure");
  const offDifferent = report(false, .2).findings.find(f => f.id === "alt_exposure");
  expect(offMatching).toMatchObject({ observed: { enabled: false, rate: null }, expected: { enabled: true, rate: .1 } });
  expect(offDifferent).toEqual(offMatching);
  expect(report(true, .1).findings.some(f => f.id === "alt_exposure")).toBe(false);
  expect(report(true, .2).findings.find(f => f.id === "alt_exposure")).toMatchObject({ observed: { enabled: true, rate: .2 }, expected: { enabled: true, rate: .1 } });
  expect(report(true, .1).findings.some(f => f.id === "position_sizing")).toBe(true);
});
it("captures effective persisted sizes and omits secrets, personal data and recovery order IDs", () => {
  const config = parseConfig({ OKX_API_KEY: "SECRET_KEY_SENTINEL", OKX_SECRET_KEY: "SECRET_SENTINEL", DATABASE_URL: "postgresql://sensitive/secret", DASHBOARD_SESSION_SECRET: "PRIVATE_SENTINEL".repeat(3), DASHBOARD_PASSWORD: "PRIVATE_PASSWORD", PAPER_TRADE_SIZE_USDT: "25", OKX_DEMO_ORDER_SIZE_USDT: "15" });
  const snapshot = effectiveExecutionSnapshot(config, { ...settings, orderSizeUsdt: 12 }, undefined);
  expect(snapshot.settings).toMatchObject({ demoOrderCeilingUsdt: 12, paperOrderCeilingUsdt: 25, paperSizeSource: "environment" });
  expect(JSON.stringify(snapshot)).not.toMatch(/SECRET|sensitive|PRIVATE|API_KEY|DATABASE_URL|PASSPHRASE/);
  expect(effectiveExecutionSnapshot(config, { ...settings, paperTradeSizeUsdt: 7 }, undefined).settings).toMatchObject({ paperOrderCeilingUsdt: 7, paperSizeSource: "dashboard" });
});
it("hashes normalized effective settings independently from capture time and rejects tampering", () => {
  const snapshot = effectiveExecutionSnapshot(parseConfig({}), settings, exitPolicySchema.parse({}));
  expect(validateExecutionSnapshot({ ...snapshot, capturedAtUtc: "2026-11-19T00:00:00Z" }).configurationHash).toBe(snapshot.configurationHash);
  expect(() => validateExecutionSnapshot({ ...snapshot, settings: { ...snapshot.settings, demoOrderCeilingUsdt: 50 } })).toThrow(/hash mismatch/);
  expect(effectiveExecutionSnapshot(parseConfig({}), { ...settings, orderSizeUsdt: 50 }, exitPolicySchema.parse({})).configurationHash).not.toBe(snapshot.configurationHash);
});
it("reports material study differences and never treats unavailable account fees as configured fees", () => {
  const snapshot = effectiveExecutionSnapshot(parseConfig({}), settings, undefined);
  const report = executionFidelityReport(snapshot, unknownFee, study);
  expect(report.status).toBe("equivalence_not_established");
  expect(report.findings.map(f => f.id)).toEqual(expect.arrayContaining(["paper_demo_size", "paper_initial_capital", "exit_policy", "paper_execution_cost", "account_fee", "portfolio_replay", "history_attribution"]));
  expect(report.findings.find(f => f.id === "account_fee")!.status).toBe("unknown");
  expect(report.findings.some(f => f.id === "study_account_fee")).toBe(false);
});
it("compares a quoted fee only within its verified symbol scope", () => {
  const snapshot = effectiveExecutionSnapshot(parseConfig({}), settings, undefined);
  const terms = { status: "confirmed" as const, symbol: "BTC/USDT", observedAtUtc: new Date().toISOString(), takerFeeRate: .004, minimumQuantity: .0001, quantityStep: .00001 };
  const report = executionFidelityReport(snapshot, terms, study);
  expect(report.findings).toContainEqual(expect.objectContaining({ id: "paper_account_fee", expected: .004 }));
  const other = executionFidelityReport(snapshot, { ...terms, symbol: "ETH/USDT" }, study);
  expect(other.findings.some(f => f.id === "study_account_fee")).toBe(false);
  expect(other.findings.find(f => f.id === "account_fee")!.status).toBe("unknown");
});
it("deduplicates concurrent read-only fee queries, expires and isolates clients/symbols", async () => {
  let now = 0;
  const cache = new TradingTermsCache(() => now);
  const client = { inspectTradingTerms: vi.fn(async () => unknownFee) };
  await Promise.all([cache.read(client, "BTC/USDT"), cache.read(client, "BTC/USDT")]);
  expect(client.inspectTradingTerms).toHaveBeenCalledTimes(1);
  now = 60000;
  await cache.read(client, "BTC/USDT");
  await cache.read(client, "ETH/USDT");
  expect(client.inspectTradingTerms).toHaveBeenCalledTimes(3);
  const failure = { inspectTradingTerms: vi.fn(async () => { throw new Error("sensitive transport error"); }) };
  expect(await cache.read(failure, "BTC/USDT")).toEqual({ status: "unavailable", reason: "query_failed" });
});
it("preserves the opening configuration through restart and leaves legacy positions unattributed", () => {
  const config = { initialBalanceUsdt: 100, tradeSizeUsdt: 10, feeRate: .001, slippageRate: 0, stopLossRate: .01, takeProfitRate: .02 };
  const candle = { timestamp: 0, open: 100, high: 100, low: 100, close: 100, volume: 1 };
  const first = new PaperTrader({ ...config, configurationHash: "a".repeat(64) });
  expect(first.processCandle(candle, true).events[0]).toMatchObject({ configurationHash: "a".repeat(64) });
  const restored = new PaperTrader({ ...config, configurationHash: "b".repeat(64) }, first.exportState());
  expect(restored.processCandle({ ...candle, timestamp: 900000, low: 90 }, false).events[0]).toMatchObject({ type: "CLOSED", configurationHash: "a".repeat(64) });
  const legacy = new PaperTrader(config); legacy.processCandle(candle, true);
  const recovered = new PaperTrader({ ...config, configurationHash: "b".repeat(64) }, legacy.exportState());
  expect(recovered.processCandle({ ...candle, timestamp: 900000, low: 90 }, false).events[0]).not.toHaveProperty("configurationHash");
});
it("identifies legacy trailing and RSI/ATR differences instead of equating disabled management with fixed exits", () => {
  const snapshot = effectiveExecutionSnapshot(parseConfig({}), settings, undefined);
  const report = executionFidelityReport(snapshot, unknownFee, { ...study, parameters: { ...study.parameters, maxBuyRsi: 63 } });
  expect(report.findings).toContainEqual(expect.objectContaining({ id: "legacy_trailing_mismatch", status: "difference" }));
  expect(report.findings).toContainEqual(expect.objectContaining({ id: "max_buy_rsi", observed: 70, expected: 63 }));
  const managed = effectiveExecutionSnapshot(parseConfig({ EXIT_MANAGEMENT_ENABLED: "true" }), settings, exitPolicySchema.parse({ mode: "fixed" }));
  expect(executionFidelityReport(managed, unknownFee).findings.some(f => f.id === "legacy_trailing_mismatch")).toBe(false);
});

it('exports pair-scoped fee quotes without cross-pair cache eviction or unbounded waiting', async()=>{
  const cache=new TradingTermsCache();
  let releases:Array<()=>void>=[];
  const client={inspectTradingTerms:vi.fn((symbol:string)=>new Promise<TradingTerms>(resolve=>{releases.push(()=>resolve({status:'confirmed',symbol,observedAtUtc:new Date().toISOString(),takerFeeRate:.004,minimumQuantity:.001,quantityStep:.001}));}))};
  const stalled=await cache.readBatch(client,Array.from({length:30},(_,i)=>`C${i}/USDT`),5);
  expect(stalled.coverage).toEqual({requested:20,completed:0,pending:20,truncated:10});
  expect(client.inspectTradingTerms).toHaveBeenCalledTimes(2);
  releases.forEach(release=>release());await new Promise(resolve=>setTimeout(resolve,1));
  expect(client.inspectTradingTerms).toHaveBeenCalledTimes(2);
  const two=await cache.readBatch(client,['C0/USDT','C1/USDT','C0/USDT']);
  expect(two.coverage.completed).toBe(2);expect(two.quotes.map(q=>q.symbol)).toEqual(['C0/USDT','C1/USDT']);
  expect(client.inspectTradingTerms).toHaveBeenCalledTimes(2);
});
it('rejects a fee response for the wrong pair instead of propagating it into calibration',async()=>{
  const cache=new TradingTermsCache();const client={inspectTradingTerms:async()=>({status:'confirmed' as const,symbol:'ETH/USDT',observedAtUtc:new Date().toISOString(),takerFeeRate:.004,minimumQuantity:.01,quantityStep:.001})};
  expect(await cache.read(client,'BTC/USDT')).toEqual({status:'unavailable',reason:'query_failed'});
});
