import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PaperTrader } from "../src/paper-trader.js";
import { PostgresPersistence } from "../src/persistence.js";
import type { Candle, QuantSignal } from "../src/types.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("PostgresPersistence", () => {
  it("serializes competing checkpoints and preserves the last checkpoint on pending orders or write failure", async () => {
    const persistence=new PostgresPersistence(databaseUrl!);
    const db=new Pool({connectionString:databaseUrl});
    const now=Date.now(), baselineAt=new Date(now-60000), id=`CPRACE${now}`;
    const input={baselineAt,observedAt:now+1000,balances:{USDT:100},evidence:{test:true},realizedPnl:0,previousObservedAt:baselineAt.getTime()};
    try {
      await persistence.initialize();
      const outcomes=await Promise.all([persistence.saveDemoAccountingCheckpoint(input),persistence.saveDemoAccountingCheckpoint({...input,observedAt:now+2000})]);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      const saved=await persistence.getDemoAccountingCheckpoint(baselineAt);
      expect(saved).not.toBeNull();
      expect((await db.query("SELECT 1 FROM demo_accounting_checkpoints WHERE baseline_at=$1",[baselineAt])).rowCount).toBe(1);
      expect(await persistence.saveDemoAccountingCheckpoint({...input,observedAt:now+3000})).toBe(false);
      await db.query("INSERT INTO demo_orders (client_order_id,symbol,candle_timestamp,status,result) VALUES ($1,'BTC/USDT',$2,'PENDING','{}'::jsonb)",[id,now]);
      expect(await persistence.saveDemoAccountingCheckpoint({...input,observedAt:now+4000,previousObservedAt:saved!.observedAt.getTime()})).toBe(false);
      await db.query("DELETE FROM demo_orders WHERE client_order_id=$1",[id]);
      await expect(persistence.saveDemoAccountingCheckpoint({...input,observedAt:now+5000,previousObservedAt:saved!.observedAt.getTime(),balances:undefined as unknown as Record<string,number>})).rejects.toThrow();
      expect((await persistence.getDemoAccountingCheckpoint(baselineAt))!.observedAt).toEqual(saved!.observedAt);
    } finally {
      await db.query("DELETE FROM demo_orders WHERE client_order_id=$1",[id]);
      await db.query("DELETE FROM demo_accounting_checkpoints WHERE baseline_at=$1",[baselineAt]);
      await db.end();await persistence.close();
    }
  });
  it("restores Demo equity risk and appends safe checkpoints without replacing older evidence", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    const db = new Pool({ connectionString: databaseUrl });
    const now = Date.now();
    const key = `test-risk-${now}`;
    const baselineAt = new Date(now - 60000);
    try {
      await persistence.initialize();
      await persistence.observeDemoRisk(key, 100, now);
      const restored = await persistence.observeDemoRisk(key, 90, now + 1);
      expect(restored.peakEquity).toBe(100);
      expect(restored.dayStartEquity).toBe(100);
      const input = { baselineAt, observedAt: now + 1000, balances: { USDT: 90 }, evidence: { test: true }, realizedPnl: -10 };
      await persistence.saveDemoAccountingCheckpoint(input);
      await persistence.saveDemoAccountingCheckpoint({ ...input, observedAt: now + 2000 });
      expect((await persistence.getDemoAccountingCheckpoint(baselineAt))?.realizedPnlOffset).toBe(-10);
      expect((await db.query("SELECT 1 FROM demo_accounting_checkpoints WHERE baseline_at = $1", [baselineAt])).rowCount).toBe(2);
    } finally {
      await db.query("DELETE FROM demo_risk_state WHERE account_id = $1", [key]);
      await db.query("DELETE FROM demo_accounting_checkpoints WHERE baseline_at = $1", [baselineAt]);
      await db.end(); await persistence.close();
    }
  });
  it("reconciles only a correlated explicit permission rejection and keeps both audit records", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    const verification = new Pool({ connectionString: databaseUrl });
    const timestamp = Date.now();
    const id = `REJECT${timestamp}`;
    const failed = `FAILED:ETH/USDT:${timestamp}`;
    try {
      await persistence.initialize();
      await verification.query("INSERT INTO demo_orders (client_order_id,symbol,candle_timestamp,status,result) VALUES ($1,'ETH/USDT',$2,'PENDING',$3::jsonb),($4,'ETH/USDT',$2,'FAILED',$5::jsonb)", [id, timestamp, JSON.stringify({ status: "PENDING" }), failed, JSON.stringify({ error: 'okx {"msg":"This API Key does not have trading permission for the Crypto","code":"50001"}' })]);
      expect(await persistence.confirmMissingPermissionRejectedOrder(id)).toBe(false);
      await verification.query("UPDATE demo_orders SET result = $2::jsonb WHERE client_order_id = $1", [failed, JSON.stringify({ error: 'okx {"msg":"This API Key does not have trading permission for the Crypto","code":"50123"}' })]);
      expect(await persistence.confirmMissingPermissionRejectedOrder(id)).toBe(true);
      expect(await persistence.confirmMissingPermissionRejectedOrder(id)).toBe(false);
      await persistence.recordDemoOrderFailure("ETH/USDT", timestamp, "retry must not replace evidence");
      const rows = await verification.query("SELECT client_order_id,status,result FROM demo_orders WHERE client_order_id = ANY($1::text[]) ORDER BY client_order_id", [[id, failed]]);
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows.every((row) => row.status === "REJECTED_CONFIRMED" && row.result.reconciliation.method === "okx_50123_and_order_not_found")).toBe(true);
      expect(rows.rows.find((row) => row.client_order_id === failed)?.result.error).toContain("50123");
      expect((await verification.query("SELECT 1 FROM audit_events WHERE event_type = 'DEMO_REJECTION_RECONCILED' AND details->>'clientOrderId' = $1", [id])).rowCount).toBe(1);
    } finally {
      await verification.query("DELETE FROM audit_events WHERE event_type = 'DEMO_REJECTION_RECONCILED' AND details->>'clientOrderId' = $1", [id]);
      await verification.query("DELETE FROM demo_orders WHERE client_order_id = ANY($1::text[])", [[id, failed]]);
      await verification.end(); await persistence.close();
    }
  });
  it("replaces only an idle identity-less baseline while retaining its audit row", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    const verification = new Pool({ connectionString: databaseUrl });
    const oldAt = Date.now() - 120_000;
    const newAt = Date.now();
    const candidate = { observedAt: newAt, balances: { USDT: 5000 }, evidence: { accountIdentity: { uid: "123", mainUid: "123" } } };
    try {
      await persistence.initialize();
      await persistence.setPaused(true, "baseline-replacement-test");
      await verification.query("INSERT INTO demo_accounting_baselines (observed_at, balances, evidence, status) VALUES (to_timestamp($1 / 1000.0), $2::jsonb, '{}'::jsonb, 'UNVERIFIED')", [oldAt, JSON.stringify({ USDT: 5000 })]);
      await persistence.saveDemoBaselineCandidate(candidate);
      const records = await verification.query("SELECT status FROM demo_accounting_baselines WHERE observed_at IN (to_timestamp($1 / 1000.0), to_timestamp($2 / 1000.0)) ORDER BY observed_at", [oldAt, newAt]);
      expect(records.rows.map((row) => row.status)).toEqual(["SUPERSEDED", "UNVERIFIED"]);
    } finally {
      await verification.query("DELETE FROM demo_accounting_baselines WHERE observed_at IN (to_timestamp($1 / 1000.0), to_timestamp($2 / 1000.0))", [oldAt, newAt]);
      await verification.end();
      await persistence.close();
    }
  });
  it("stores baseline candidates as unverified only while paused with no pending orders", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    const verification = new Pool({ connectionString: databaseUrl });
    const observedAt = Date.now();
    const pendingId = `BASELINE${observedAt}`;
    const candidate = { observedAt, balances: { BTC: 1, USDT: 5000 }, evidence: { source: "test", accountIdentity: { uid: "123", mainUid: "123" } } };
    try {
      await persistence.initialize();
      await persistence.setPaused(false, "baseline-test");
      await expect(persistence.saveDemoBaselineCandidate(candidate)).rejects.toThrow("paused");
      await persistence.setPaused(true, "baseline-test");
      await expect(persistence.saveDemoBaselineCandidate({ ...candidate, balances: { BTC: NaN, USDT: 0 } })).rejects.toThrow("Invalid");
      await persistence.reserveDemoOrder("BTC/USDT", observedAt, pendingId);
      await expect(persistence.saveDemoBaselineCandidate(candidate)).rejects.toThrow("Pending");
      await verification.query("DELETE FROM demo_orders WHERE client_order_id = $1", [pendingId]);
      await persistence.saveDemoBaselineCandidate(candidate);
      const result = await verification.query("SELECT balances, status FROM demo_accounting_baselines WHERE observed_at = to_timestamp($1 / 1000.0)", [observedAt]);
      expect(result.rows).toEqual([expect.objectContaining({ balances: candidate.balances, status: "UNVERIFIED" })]);
      await expect(persistence.getDemoBaselineCandidate()).resolves.toMatchObject({ balances: candidate.balances, status: "UNVERIFIED" });
    } finally {
      await verification.query("DELETE FROM demo_orders WHERE client_order_id = $1", [pendingId]);
      await verification.query("DELETE FROM demo_accounting_baselines WHERE observed_at = to_timestamp($1 / 1000.0)", [observedAt]);
      await verification.end();
      await persistence.close();
    }
  });
  it("retrieves older Demo failures only when the diagnostic range includes them", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    const verification = new Pool({ connectionString: databaseUrl });
    const timestamp = Date.now();
    const id = `FAILED:LOGTEST/USDT:${timestamp}`;
    try {
      await persistence.initialize();
      await persistence.recordDemoOrderFailure("LOGTEST/USDT", timestamp, "diagnostic test failure");
      await verification.query("UPDATE demo_orders SET created_at = NOW() - INTERVAL '10 days' WHERE client_order_id = $1", [id]);
      const recent = JSON.parse(await persistence.getDiagnosticLogs(6, 500));
      const older = JSON.parse(await persistence.getDiagnosticLogs(720, 500));
      expect(recent.records.some((item: { symbol?: string }) => item.symbol === "LOGTEST/USDT")).toBe(false);
      expect(older.records).toEqual(expect.arrayContaining([expect.objectContaining({ section: "demo_orders", symbol: "LOGTEST/USDT", status: "FAILED" })]));
      expect(older.scope.hours).toBe(720);
    } finally {
      await verification.query("DELETE FROM demo_orders WHERE client_order_id = $1", [id]);
      await verification.end();
      await persistence.close();
    }
  });
  it("persists pending intent, blocks further orders, and reconciles without losing the ID", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    const verification = new Pool({ connectionString: databaseUrl });
    const id = `INTENT${Date.now()}`;
    const protectionId = `PROTECT${Date.now()}`;
    try {
      await persistence.initialize();
      expect(await persistence.reserveDemoOrder("BTC/USDT", Date.now(), id, 1, 60, protectionId)).toBe(true);
      expect(await persistence.demoOrderJournal()).toEqual(expect.arrayContaining([expect.objectContaining({ client_order_id: id, attached_algo_client_id: protectionId })]));
      expect((await persistence.demoOrderJournal(new Date(Date.now() + 60_000))).some((entry) => entry.client_order_id === id)).toBe(false);
      await expect(persistence.demoOrderJournal(new Date(NaN))).rejects.toThrow("Invalid Demo journal start date");
      expect(await persistence.reserveDemoOrder("BTC/USDT", Date.now(), id)).toBe(false);
      expect(await persistence.canPlaceDemoOrder(99, 15)).toBe(false);
      expect(await persistence.pendingDemoOrders()).toEqual(expect.arrayContaining([expect.objectContaining({ client_order_id: id })]));
      await persistence.reconcileDemoOrder(id, { id: "exchange-id", status: "canceled", filled: 0.05, cost: 5, fee: { currency: "USDT", cost: 0.005 } });
      let partial = await verification.query("SELECT status, result FROM demo_orders WHERE client_order_id = $1", [id]);
      expect(partial.rows[0]).toMatchObject({ status: "PENDING", result: { filled: 0.05, confirmed: false } });
      await persistence.reconcileDemoOrder(id, { id: "exchange-id", status: "closed", filled: 0.1, cost: 10 });
      await persistence.recordDemoOrder("BTC/USDT", Date.now(), { status: "PENDING", orderId: "exchange-id", clientOrderId: id, orderStatus: "open", filled: 0, average: null, cost: null, referencePrice: 100, stopLossPrice: 99, takeProfitPrice: 102, confirmed: false });
      const result = await verification.query("SELECT status, result, attached_algo_client_id FROM demo_orders WHERE client_order_id = $1", [id]);
      expect(result.rows[0]).toMatchObject({ status: "PLACED", attached_algo_client_id: protectionId, result: { confirmed: true, orderId: "exchange-id", filled: 0.1, fees: [{ currency: "USDT", cost: 0.005 }] } });
    } finally {
      await verification.query("DELETE FROM demo_orders WHERE client_order_id = $1", [id]);
      await verification.end();
      await persistence.close();
    }
  });
  it("atomically allows at most one concurrent pending intent across connections", async () => {
    const first = new PostgresPersistence(databaseUrl!);
    const second = new PostgresPersistence(databaseUrl!);
    const verification = new Pool({ connectionString: databaseUrl });
    const ids = [`RACEA${Date.now()}`, `RACEB${Date.now()}`];
    try {
      await first.initialize();
      const results = await Promise.all([
        first.reserveDemoOrder("BTC/USDT", Date.now(), ids[0]!, 99, 15),
        second.reserveDemoOrder("ETH/USDT", Date.now(), ids[1]!, 99, 15),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    } finally {
      await verification.query("DELETE FROM demo_orders WHERE client_order_id = ANY($1::text[])", [ids]);
      await verification.end();
      await first.close();
      await second.close();
    }
  });
  it("migrates idempotently and persists a recoverable cycle", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    await persistence.initialize();
    await persistence.initialize();

    const dashboardSettings = await persistence.ensureDashboardSettings({
      symbol: "BTC/USDT",
      orderSizeUsdt: 10,
      maxTrades: 2,
      intervalMinutes: 60,
      maxConcurrentPositions: 2,
    });
    expect(dashboardSettings.symbol).toBeTruthy();
    await persistence.setPaused(true, "integration-test");
    await expect(persistence.isPaused()).resolves.toBe(true);
    await persistence.setPaused(false, "integration-test");

    const symbol = `TEST/${Date.now()}`;
    const candle: Candle = {
      timestamp: Date.now(),
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
    };
    const signal: QuantSignal = {
      action: "HOLD",
      candleTimestamp: candle.timestamp,
      price: 100,
      ema9: 100,
      ema21: 100,
      previousEma9: 100,
      previousEma21: 100,
      rsi14: 50,
      score: 5,
      scoreThreshold: 5,
      scoreBreakdown: { trend: 1, rsi: 2, volume: 1, momentum: 1, volatility: 0, stopDistance: 0 },
      volumeRatio: 1,
      momentumPercent: 1,
      volatilityPercent: 0,
      stopDistancePercent: 0,
      reason: "integration test",
    };
    const trader = new PaperTrader({
      initialBalanceUsdt: 1000,
      tradeSizeUsdt: 100,
      feeRate: 0.001,
      slippageRate: 0.0005,
      stopLossRate: 0.01,
      takeProfitRate: 0.02,
    });
    const paperResult = trader.processCandle(candle, false);

    await persistence.recordCycle({
      symbol,
      candle,
      replayed: false,
      paperResult,
      paperState: trader.exportState(),
      decision: {
        mode: "PAPER",
        signal,
        aiDecision: { approve: false, confidence: 0, reason: "HOLD" },
        approved: false,
      },
    });

    await expect(
      persistence.recordCycle({
        symbol,
        candle: { ...candle, timestamp: candle.timestamp - 900_000 },
        replayed: true,
        paperResult,
        paperState: trader.exportState(),
      }),
    ).rejects.toThrow("Refusing to overwrite a newer portfolio checkpoint");

    const runId = await persistence.startRun({ source: "integration-test" });
    await persistence.stopRun(runId, "test_complete");
    await persistence.recordDemoOrder(symbol, candle.timestamp, {
      status: "SKIPPED",
      reason: "existing_open_order",
      clientOrderId: `TEST${candle.timestamp}`,
    });
    await persistence.recordCycle({
      symbol,
      candle,
      replayed: false,
      paperResult,
      paperState: trader.exportState(),
      decision: {
        mode: "PAPER",
        signal,
        aiDecision: { approve: false, confidence: 0, reason: "HOLD" },
        approved: false,
      },
    });

    await expect(persistence.loadRecoveryState(symbol)).resolves.toEqual({
      lastProcessedCandle: candle.timestamp,
      paperState: trader.exportState(),
    });
    await expect(persistence.isPaused()).resolves.toBe(false);

    const verification = new Pool({ connectionString: databaseUrl });
    const counts = await verification.query<{
      decisions: string;
      snapshots: string;
      orders: string;
      stoppedRuns: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM decisions WHERE symbol = $1) AS decisions,
         (SELECT COUNT(*) FROM portfolio_snapshots WHERE symbol = $1) AS snapshots,
         (SELECT COUNT(*) FROM demo_orders WHERE symbol = $1) AS orders,
         (SELECT COUNT(*) FROM bot_runs
          WHERE id = $2 AND stopped_at IS NOT NULL) AS "stoppedRuns"`,
      [symbol, runId],
    );
    expect(counts.rows[0]).toEqual({
      decisions: "1",
      snapshots: "1",
      orders: "1",
      stoppedRuns: "1",
    });

    await verification.end();
    await persistence.close();
  });
});

