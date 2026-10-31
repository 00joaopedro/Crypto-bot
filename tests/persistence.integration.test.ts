import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PaperTrader } from "../src/paper-trader.js";
import { PostgresPersistence } from "../src/persistence.js";
import type { Candle, QuantSignal } from "../src/types.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("PostgresPersistence", () => {
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

