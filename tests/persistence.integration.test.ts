import { TREND_STRATEGY_ID } from "../src/strategy-id.js";
import type { Order } from "ccxt";
import { reconcilePendingDemoOrders } from "../src/demo-pending-reconciliation.js";
import { inspectDemoExecutionState } from "../src/demo-execution-safety.js";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { exitPolicySchema } from "../src/exit-policy.js";
import { PaperTrader } from "../src/paper-trader.js";
import { PostgresPersistence } from "../src/persistence.js";
import type { Candle, QuantSignal } from "../src/types.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("PostgresPersistence", () => {
  it("counts orders within a rolling window and blocks any unresolved order", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    const db = new Pool({ connectionString: databaseUrl });
    const now = Date.now();
    const ids = Array.from({ length: 6 }, (_, index) => `WINDOW${now}X${index}`);
    try {
      await persistence.initialize();
      for (const [index, id] of ids.slice(0, 5).entries()) {
        expect(await persistence.reserveDemoOrder("BTC/USDT", now + index, id, 5, 15)).toBe(true);
        await db.query("UPDATE demo_orders SET status = 'PLACED' WHERE client_order_id = $1", [id]);
      }
      expect(await persistence.canPlaceDemoOrder(5, 15)).toBe(false);
      expect(await persistence.canPlaceDemoOrder(10, 15)).toBe(true);
      expect(await persistence.reserveDemoOrder("ETH/USDT", now, ids[5]!, 5, 15)).toBe(false);

      // Aging journal records does not delete an order or close its position.
      await db.query("UPDATE demo_orders SET created_at = NOW() - INTERVAL '16 minutes' WHERE client_order_id = ANY($1::text[])", [ids]);
      expect(await persistence.reserveDemoOrder("ETH/USDT", now, ids[5]!, 5, 15)).toBe(true);
      await db.query("UPDATE demo_orders SET created_at = NOW() - INTERVAL '16 minutes' WHERE client_order_id = $1", [ids[5]]);
      expect(await persistence.canPlaceDemoOrder(50, 15)).toBe(false);
      const journal = await persistence.demoOrderJournal();
      expect(journal.filter(row => ids.includes(row.client_order_id) && row.status === "PLACED")).toHaveLength(5);
    } finally {
      await db.query("DELETE FROM demo_orders WHERE client_order_id = ANY($1::text[])", [ids]);
      await db.end();
      await persistence.close();
    }
  });
  it("rejects an entry reservation after another admitted order fills", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    const db = new Pool({ connectionString: databaseUrl });
    const now = Date.now();
    const firstId = "RISKFIRST" + now;
    const secondId = "RISKSECOND" + now;
    try {
      await persistence.initialize();
      const revision = await persistence.readDemoEntryRevision();
      expect(await persistence.reserveDemoOrder("BTC/USDT", now, firstId, 99, 60, null, revision)).toBe(true);
      await db.query("UPDATE demo_orders SET status = 'PLACED' WHERE client_order_id = $1", [firstId]);
      expect(await persistence.reserveDemoOrder("ETH/USDT", now, secondId, 99, 60, null, revision)).toBe(false);
      const freshRevision = await persistence.readDemoEntryRevision();
      expect(await persistence.reserveDemoOrder("ETH/USDT", now, secondId, 99, 60, null, freshRevision)).toBe(true);
    } finally {
      await db.query("DELETE FROM demo_orders WHERE client_order_id = ANY($1::text[])", [[firstId, secondId]]);
      await db.end();
      await persistence.close();
    }
  });


  it("persists an exit policy before execution and arbitrates concurrent amendments across connections", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    const other = new PostgresPersistence(databaseUrl!);
    const db = new Pool({ connectionString: databaseUrl });
    const now = Date.now(), client = `EXIT${now}`, algo = `APEXIT${now}`;
    let baselineId: string | undefined;
    try {
      await persistence.initialize();
      const baseline = await db.query(`INSERT INTO demo_accounting_baselines (observed_at,balances,evidence,status) VALUES (NOW(),'{}','{"accountIdentity":{"uid":"123","mainUid":"123"}}','UNVERIFIED') RETURNING id`);
      baselineId = baseline.rows[0].id;
      expect(await persistence.reserveDemoOrder("BTC/USDT",now,client,5,60,algo)).toBe(true);
      await persistence.registerDemoExit(client,algo,"BTC/USDT",now,exitPolicySchema.parse({ mode:"trailing_atr" }));
      const row = (await other.managedDemoExits()).find(row => row.algo_client_id === algo)!;
      expect(row.state.policy.mode).toBe("trailing_atr");
      const state = { ...row.state,pending:{requestId:"REQ1",stop:105},highWatermark:110 };
      const results = await Promise.all([persistence.saveDemoExitState(algo,row.version,state),other.saveDemoExitState(algo,row.version,state)]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await other.isDemoExitReserved(algo,"REQ1",105)).toBe(true);
      expect(await other.isDemoExitReserved(algo,"OTHER",105)).toBe(false);
      const restored=(await other.managedDemoExits()).find(row => row.algo_client_id === algo)!;
      expect(restored.state.pending).toEqual({requestId:"REQ1",stop:105});
      expect(await other.saveDemoExitState(algo,row.version,{...row.state,pending:null})).toBe(false);
    } finally {
      await db.query("DELETE FROM demo_exit_state WHERE algo_client_id=$1",[algo]);
      await db.query("DELETE FROM demo_orders WHERE client_order_id=$1",[client]);
      if (baselineId) await db.query("DELETE FROM demo_accounting_baselines WHERE id=$1",[baselineId]);
      await db.end(); await persistence.close(); await other.close();
    }
  });
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
      const basis = { budgetUsdt: 5000, baselineAt: baselineAt.getTime() };
      await persistence.observeDemoRisk(`${key}:bot-equity-v1`, 4999.91, now, basis);
      const reopened = new PostgresPersistence(databaseUrl!);
      try {
        const botRisk = await reopened.observeDemoRisk(`${key}:bot-equity-v1`, 4849, now + 1, basis);
        expect(botRisk).toMatchObject({ dayStartEquity: 5000, peakEquity: 5000, equity: 4849, basis });
        await expect(reopened.observeDemoRisk(`${key}:bot-equity-v1`, 6000, now + 2, { ...basis, budgetUsdt: 6000 })).rejects.toThrow(/basis changed/);
        // The failed basis change rolls back, and the legacy account state is untouched.
        const retained = await reopened.observeDemoRisk(`${key}:bot-equity-v1`, 4849, now + 3, basis);
        expect(retained.dayStartEquity).toBe(5000);
        const legacy = await reopened.observeDemoRisk(key, 90, now + 3);
        expect(legacy.peakEquity).toBe(100);
      } finally { await reopened.close(); }
      const input = { baselineAt, observedAt: now + 1000, balances: { USDT: 90 }, evidence: { test: true }, realizedPnl: -10 };
      await persistence.saveDemoAccountingCheckpoint(input);
      await persistence.saveDemoAccountingCheckpoint({ ...input, observedAt: now + 2000 });
      expect((await persistence.getDemoAccountingCheckpoint(baselineAt))?.realizedPnlOffset).toBe(-10);
      expect((await db.query("SELECT 1 FROM demo_accounting_checkpoints WHERE baseline_at = $1", [baselineAt])).rowCount).toBe(2);
    } finally {
      await db.query("DELETE FROM demo_risk_state WHERE account_id = ANY($1::text[])", [[key, `${key}:bot-equity-v1`]]);
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
    await persistence.setPaused(false, "dashboard");
    await persistence.setPaused(true, "system:demo_execution_safety", "demo_balance_unconfirmed");
    await expect(persistence.isPaused()).resolves.toBe(true);
    await expect(persistence.getDashboardData()).resolves.toMatchObject({ paused: true, pauseReason: "demo_balance_unconfirmed" });
    await persistence.setPaused(false, "dashboard");
    await expect(persistence.getDashboardData()).resolves.toMatchObject({ paused: false, pauseReason: null });

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

    const controlBefore = await persistence.readControlState();
    const checkpoint = { symbol: `${symbol}-PAUSE`, candle: { ...candle, timestamp: candle.timestamp + 900_000 }, replayed: true, paperResult, paperState: trader.exportState() };
    const alerts = async () => (JSON.parse(await persistence.getDiagnosticLogs(1, 500)).records as Array<{ event_type: string; details?: { actor?: string } }>)
      .filter(row => row.event_type === "BOT_PAUSED" && row.details?.actor === "system:consecutive_losses").length;
    const previousAlerts = await alerts();
    await persistence.recordCycle({ ...checkpoint, lossPause: { controlRevision: controlBefore.revision } });
    await persistence.setPaused(true, "system:consecutive_losses");
    expect(await alerts()).toBe(previousAlerts + 1);
    await persistence.setPaused(false, "dashboard");
    await persistence.recordCycle({ ...checkpoint, candle: { ...candle, timestamp: candle.timestamp + 1_800_000 },
      lossPause: { controlRevision: controlBefore.revision } });
    await expect(persistence.isPaused()).resolves.toBe(false);
    expect(await alerts()).toBe(previousAlerts + 1);

    const percentControl = await persistence.readControlState();
    const percentCheckpoint = { ...checkpoint, candle: { ...candle, timestamp: candle.timestamp + 1_800_000 } };
    await persistence.recordCycle({ ...percentCheckpoint, riskPause: { reason: "paper_daily_loss_limit", controlRevision: percentControl.revision } });
    await expect(persistence.readControlState()).resolves.toMatchObject({ paused: true, pauseReason: "paper_daily_loss_limit" });
    const percentRevision = (await persistence.readControlState()).revision;
    await persistence.recordCycle({ ...percentCheckpoint, riskPause: { reason: "paper_daily_loss_limit" } });
    expect((await persistence.readControlState()).revision).toBe(percentRevision);
    await persistence.setPaused(false, "dashboard");
    await persistence.recordCycle({ ...percentCheckpoint, riskPause: { reason: "paper_drawdown_limit", controlRevision: percentControl.revision } });
    await expect(persistence.isPaused()).resolves.toBe(false);
    await expect(persistence.recordCycle({ ...checkpoint, riskPause: { reason: "paper_drawdown_limit" } })).rejects.toThrow("newer portfolio checkpoint");
    await expect(persistence.isPaused()).resolves.toBe(false);

    await persistence.setPaused(true, "system:consecutive_losses");
    const timedPause = await persistence.readControlState();
    await persistence.setPaused(true, "system:demo_exit_supervision", "pending_demo_order");
    expect(await persistence.readControlState()).toEqual(timedPause);
    await persistence.setPaused(true, "dashboard");
    await persistence.setPaused(true, "system:demo_execution_safety", "demo_balance_unconfirmed");
    await expect(persistence.setPaused(false, "system:auto_resume", undefined, timedPause.revision)).resolves.toBe(false);
    await expect(persistence.readControlState()).resolves.toMatchObject({ paused: true, updatedBy: "dashboard", pauseReason: null });
    await persistence.setPaused(false, "dashboard");
    await persistence.recordCycle({ ...checkpoint, candle: { ...candle, timestamp: candle.timestamp + 2_700_000 },
      riskState: { consecutiveLosses: 3, stopLossCooldownUntil: candle.timestamp + 3_600_000 } });
    await persistence.setPaused(true, "system:consecutive_losses");
    const autoPause = await persistence.readControlState();
    await expect(persistence.setPaused(false, "system:auto_resume", undefined, autoPause.revision)).resolves.toBe(true);
    await expect(persistence.loadRecoveryState(checkpoint.symbol)).resolves.toMatchObject({
      riskState: { consecutiveLosses: 0, stopLossCooldownUntil: candle.timestamp + 3_600_000 },
    });

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
        strategyId: TREND_STRATEGY_ID,
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

    const attribution = await verification.query(`SELECT
      (SELECT strategy_id FROM decisions WHERE symbol = $1) AS decision_strategy,
      (SELECT strategy_id FROM demo_orders WHERE symbol = $1) AS legacy_order_strategy`, [symbol]);
    expect(attribution.rows[0]).toEqual({ decision_strategy: TREND_STRATEGY_ID, legacy_order_strategy: null });

    await verification.end();
    await persistence.close();
  });
});


integration("configuração e estatísticas Paper", () => {
  it("persists, preserves and clears the independent Paper lot", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    try {
      await persistence.initialize();
      const current = await persistence.ensureDashboardSettings({
        symbol: "BTC/USDT", orderSizeUsdt: 10, maxTrades: 10, maxConcurrentPositions: 10, intervalMinutes: 15,
      });
      try {
        const { paperTradeSizeUsdt: _previous, ...other } = current;
        await persistence.updateDashboardSettings({ ...other, paperTradeSizeUsdt: 10 }, "test");
        await persistence.updateDashboardSettings(other, "test");
        await expect(persistence.getDashboardSettings()).resolves.toMatchObject({ orderSizeUsdt: current.orderSizeUsdt, paperTradeSizeUsdt: 10 });
        await persistence.updateDashboardSettings({ ...other, paperTradeSizeUsdt: null }, "test");
        await expect(persistence.getDashboardSettings()).resolves.toMatchObject({ paperTradeSizeUsdt: null });
      } finally {
        await persistence.updateDashboardSettings(current, "test");
      }
    } finally {
      await persistence.close();
    }
  });

  it("filters closed trades by entry date and keeps the lifetime dashboard totals", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    const db = new Pool({ connectionString: databaseUrl });
    const since = Date.now(), symbol = "EXPERIMENT/USDT";
    const ids = [`PAPER-OLD-${since}`, `PAPER-NEW-${since}`];
    try {
      await persistence.initialize();
      await persistence.ensureDashboardSettings({
        symbol: "BTC/USDT", orderSizeUsdt: 10, maxTrades: 10, maxConcurrentPositions: 10, intervalMinutes: 15,
      });
      for (const [index, id] of ids.entries()) {
        const trade = { entryTimestamp: since + (index - 1) * 900_000, exitTimestamp: since + 900_000, netPnlUsdt: index === 0 ? -50 : 1 };
        await db.query(`INSERT INTO paper_trades (event_key, symbol, event_type, candle_timestamp, replayed, trade)
          VALUES ($1, $2, 'CLOSED', $3, false, $4)`, [id, symbol, trade.exitTimestamp, JSON.stringify(trade)]);
      }
      const all = await persistence.getDashboardData();
      const filtered = await persistence.getDashboardData(40, undefined, since);
      expect(all.analytics.bySymbol[symbol]).toMatchObject({ trades: 2, netPnlUsdt: -49 });
      expect(filtered.analytics.bySymbol[symbol]).toMatchObject({ trades: 1, netPnlUsdt: 1 });
      expect(filtered.metrics.netPnlUsdt).toBe(all.metrics.netPnlUsdt);
      expect(filtered.metrics.closedTrades).toBe(all.metrics.closedTrades);
    } finally {
      await db.query("DELETE FROM paper_trades WHERE event_key = ANY($1::text[])", [ids]);
      await db.end();
      await persistence.close();
    }
  });
});

integration("Demo recovery after restarting the worker", () => {
  it("holds a partly filled buy until exchange readback confirms the fill and protection", async () => {
    const db = new Pool({ connectionString: databaseUrl });
    const before = new PostgresPersistence(databaseUrl!);
    const after = new PostgresPersistence(databaseUrl!);
    const now = Date.now();
    const clientOrderId = `CBRESTART${now}`, algoClientId = `APRESTART${now}`;
    const symbol = "BTC/USDT", id = "1", identity = { uid: "123", mainUid: "123" };
    let baselineId: string | undefined;
    try {
      await before.initialize();
      const baseline = await db.query(`INSERT INTO demo_accounting_baselines (observed_at, balances, evidence, status)
        VALUES (date_trunc('milliseconds', clock_timestamp()) + INTERVAL '1 millisecond', '{"USDT": 5000}', $1::jsonb, 'UNVERIFIED') RETURNING id, observed_at`, [JSON.stringify({ accountIdentity: identity })]);
      baselineId = baseline.rows[0].id;
      expect(await before.reserveDemoOrder(symbol, now, clientOrderId, 50, 15, algoClientId, undefined, TREND_STRATEGY_ID)).toBe(true);
      await db.query("UPDATE demo_orders SET created_at = GREATEST(created_at, $2::timestamptz) WHERE client_order_id = $1", [clientOrderId, baseline.rows[0].observed_at]);
      await expect(before.demoOrderJournal()).resolves.toContainEqual(expect.objectContaining({ client_order_id: clientOrderId, status: "PENDING", strategy_id: TREND_STRATEGY_ID }));
      await before.close();

      const filled = .009;
      const order = { id, clientOrderId, symbol, side: "buy" as const, status: "open", filled };
      const reconciliation = { reconcileOrder: async () => order as Order, inspectAccountIdentity: async () => ({ status: "confirmed" as const, identity }) };
      let live = false;
      const reader = { collectOrderEvidence: async () => ({
        status: "collected" as const,
        buys: [{ id, clientOrderId, symbol, side: "buy" as const, attachedAlgoClientIds: [algoClientId] }],
        sells: [],
        protections: [{ algoClientId, symbol, side: "sell" as const, spawnedOrderIds: [] }],
        protectionStates: { [algoClientId]: live ? "live" : "canceled" },
        orders: [{ id, symbol, side: "buy" as const, filled: order.filled, terminal: true, ownershipConfirmed: false }],
      }) };
      await reconcilePendingDemoOrders(after, reconciliation);
      await expect(inspectDemoExecutionState(after, reader)).resolves.toMatchObject({ reason: "pending_demo_order" });
      order.status = "closed";
      await reconcilePendingDemoOrders(after, reconciliation);
      await expect(inspectDemoExecutionState(after, reader)).resolves.toMatchObject({ reason: "demo_position_without_live_protection" });
      live = true;
      await expect(after.demoOrderJournal()).resolves.toContainEqual(expect.objectContaining({ client_order_id: clientOrderId, status: "PLACED", strategy_id: TREND_STRATEGY_ID }));
      await expect(inspectDemoExecutionState(after, reader)).resolves.toEqual({ status: "safe", positions: [{ symbol, quantity: .009 }] });
    } finally {
      await before.close().catch(() => undefined);
      await db.query("DELETE FROM demo_orders WHERE client_order_id = $1", [clientOrderId]);
      if (baselineId) await db.query("DELETE FROM demo_accounting_baselines WHERE id = $1", [baselineId]);
      await db.end();
      await after.close();
    }
  });
});

integration("pair cooldown history", () => {
  it("derives the active cooldown from durable losses and releases the pair when it expires", async () => {
    const store = new PostgresPersistence(databaseUrl!);
    const db = new Pool({ connectionString: databaseUrl });
    const symbol = "COOLDOWNTEST/USDT", now = Date.now(), keys = [0, 1, 2].map(i => `cooldown-${now}-${i}`);
    try {
      await store.initialize();
      for (const [index, key] of keys.entries()) {
        await db.query(`INSERT INTO paper_trades (event_key, symbol, event_type, candle_timestamp, replayed, trade)
          VALUES ($1,$2,'CLOSED',$3,false,'{"netPnlUsdt":-1}')`, [key, symbol, now - 900_000 - index * 3_600_000]);
      }
      const policy = { hours: 6, minLosses: 3 };
      const until = now + 6 * 3_600_000;
      expect(await store.activePairCooldowns(now, policy)).toContainEqual({ symbol, until });
      expect(await store.activePairCooldowns(until, policy)).not.toContainEqual(expect.objectContaining({ symbol }));
    } finally {
      await db.query("DELETE FROM paper_trades WHERE event_key = ANY($1::text[])", [keys]);
      await db.end();
      await store.close();
    }
  });
  it("persists the Demo cycle and alerts only on confirmed rolling threshold crossings", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    const restarted = new PostgresPersistence(databaseUrl!);
    const db = new Pool({ connectionString: databaseUrl });
    const baselineAt = new Date(Date.now() - 100_000);
    const uid = String(Date.now());
    const accountId = `${uid}:${uid}`;
    const evidence = { accountIdentity: { uid, mainUid: uid } };
    let previousStart: Date | null = null;
    const testMarkers: string[] = [];
    try {
      await persistence.initialize();
      await persistence.ensureDashboardSettings({ symbol: "BTC/USDT", orderSizeUsdt: 10,
        maxTrades: 10, intervalMinutes: 15, maxConcurrentPositions: 10 });
      const previous = await db.query("SELECT cycle_started_at FROM dashboard_settings WHERE id = 1");
      previousStart = previous.rows[0].cycle_started_at;
      const started = (await persistence.startDemoCycle(previousStart?.toISOString() ?? null))!;
      testMarkers.push(started);
      expect(started).toBeTruthy();
      await expect(restarted.startDemoCycle(previousStart?.toISOString() ?? null)).resolves.toBeNull();
      await db.query(`INSERT INTO demo_accounting_baselines (observed_at, balances, evidence, status)
        VALUES ($1, '{"USDT":1000}', $2::jsonb, 'UNVERIFIED')`, [baselineAt, JSON.stringify(evidence)]);
      const start = Date.parse(started);
      const trade = (i: number, pnl: number, openedAt = start) => ({
        buyOrderId: String(i), openedAt, closedAt: start + i + 1, netPnlUsdt: pnl,
      });
      const save = (step: number, closedTrades: ReturnType<typeof trade>[]) =>
        persistence.saveDemoAccountingCheckpoint({ baselineAt, observedAt: start + step * 1000,
          balances: { USDT: 1000 }, evidence, realizedPnl: 0, closedTrades });
      const warnings = async () => (await db.query(
        "SELECT details FROM operational_events WHERE event_type = 'EDGE_DEGRADATION' AND (details->>'cycleStartedAt')::timestamptz = $1",
        [started])).rows;
      const first = Array.from({ length: 29 }, (_, i) => trade(i, -1));
      expect(await save(1, [...first, trade(99, -100, start - 1)])).toBe(true);
      expect(await restarted.getDemoCycle()).toMatchObject({ cycleStartedAt: started, closedTrades: 29, netPnlUsdt: -29,
        rolling: { sampleSize: 29, degraded: false } });
      expect(await warnings()).toHaveLength(0);

      // A late close (older than the latest exchange timestamp) still enters the present sample.
      const late = trade(100, -1);
      late.closedAt = start + 2;
      expect(await save(2, [...first, late])).toBe(true);
      expect(await restarted.getDemoCycle()).toMatchObject({ closedTrades: 30, netPnlUsdt: -30, profitFactor: 0,
        rolling: { sampleSize: 30, degraded: true } });
      expect(await warnings()).toHaveLength(1);
      expect(await save(3, [...first, late, trade(101, -1)])).toBe(true);
      expect(await warnings()).toHaveLength(1);
      expect(await save(4, [trade(102, 30)])).toBe(true);
      expect((await restarted.getDemoCycle())?.rolling.degraded).toBe(false);
      const moreLosses = Array.from({ length: 30 }, (_, i) => trade(i + 103, -1));
      expect(await save(5, moreLosses)).toBe(true);
      expect(await warnings()).toHaveLength(2);
      expect((await restarted.getDemoCycle())?.rolling.degraded).toBe(true);

      const next = (await restarted.startDemoCycle(started))!;
      testMarkers.push(next);
      expect(next).not.toBe(started);
      expect(await persistence.getDemoCycle()).toMatchObject({ cycleStartedAt: next, closedTrades: 0,
        rolling: { sampleSize: 0, degraded: false } });
      const history = await db.query("SELECT COUNT(*)::int AS count FROM demo_closed_trades WHERE account_id = $1", [accountId]);
      expect(history.rows[0].count).toBe(63);
    } finally {
      await db.query("DELETE FROM operational_events WHERE event_type IN ('DEMO_CYCLE_STARTED', 'EDGE_DEGRADATION') AND (details->>'cycleStartedAt')::timestamptz = ANY($1::timestamptz[])", [testMarkers]);
      await db.query("UPDATE dashboard_settings SET cycle_started_at = $1 WHERE id = 1", [previousStart]);
      await db.query("DELETE FROM demo_closed_trades WHERE account_id = $1", [accountId]);
      await db.query("DELETE FROM demo_accounting_checkpoints WHERE baseline_at = $1", [baselineAt]);
      await db.query("DELETE FROM demo_accounting_baselines WHERE evidence = $1::jsonb", [JSON.stringify(evidence)]);
      await db.end();
      await persistence.close();
      await restarted.close();
    }
  });
});

integration("configuration provenance", () => {
  it("retains the opening configuration hash across Paper recovery and persisted closure", async () => {
    const persistence = new PostgresPersistence(databaseUrl!);
    const db = new Pool({ connectionString: databaseUrl });
    const symbol = `FIDELITY${Date.now()}/USDT`;
    try {
      await persistence.initialize();
      const configuration = { initialBalanceUsdt: 100, tradeSizeUsdt: 10, feeRate: .001, slippageRate: 0, stopLossRate: .01, takeProfitRate: .02 };
      const candle: Candle = { timestamp: Date.now(), open: 100, high: 100, low: 100, close: 100, volume: 1 };
      const trader = new PaperTrader({ ...configuration, configurationHash: "a".repeat(64) });
      const opened = trader.processCandle(candle, true);
      await persistence.recordCycle({ symbol, candle, replayed: false, paperResult: opened, paperState: trader.exportState() });
      const state = await persistence.loadRecoveryState(symbol);
      expect(state?.paperState.position?.configurationHash).toBe("a".repeat(64));
      const restored = new PaperTrader({ ...configuration, configurationHash: "b".repeat(64) }, state!.paperState);
      const next = { ...candle, timestamp: candle.timestamp + 900000, low: 90 };
      await persistence.recordCycle({ symbol, candle: next, replayed: false, paperResult: restored.processCandle(next, false), paperState: restored.exportState() });
      const rows = await db.query("SELECT trade->>'configurationHash' AS hash FROM paper_trades WHERE symbol = $1", [symbol]);
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows.every(row => row.hash === "a".repeat(64))).toBe(true);
    } finally {
      for (const table of ["paper_trades", "portfolio_snapshots", "paper_trader_state"]) await db.query(`DELETE FROM ${table} WHERE symbol = $1`, [symbol]);
      await db.end(); await persistence.close();
    }
  });
});
