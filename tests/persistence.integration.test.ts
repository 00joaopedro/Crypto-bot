import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PaperTrader } from "../src/paper-trader.js";
import { PostgresPersistence } from "../src/persistence.js";
import type { Candle, QuantSignal } from "../src/types.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("PostgresPersistence", () => {
  it("migrates idempotently and persists a recoverable cycle", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    await persistence.initialize();
    await persistence.initialize();

    const dashboardSettings = await persistence.ensureDashboardSettings({
      symbol: "BTC/USDT",
      orderSizeUsdt: 10,
      maxTrades: 2,
      intervalMinutes: 60,
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
