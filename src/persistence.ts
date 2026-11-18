import { EDGE_SAMPLE_SIZE, EDGE_THRESHOLD, profitFactor, rollingDemoEdge } from "./demo-cycle.js";
import type { ConfirmedDemoTrade } from "./demo-ledger.js";
import type { ManagedPosition } from "./trade-manager.js";
import type { StrategyId } from "./strategy-id.js";
import { REGIME_CANDLE_MS } from "./btc-regime.js";
import { pairCooldownUntil, HOUR_MS, PAIR_COOLDOWN_LOOKBACK_MS, type PairCooldown } from "./pair-cooldown.js";
import { DEFAULT_DEMO_ORDERS_PER_INTERVAL, MAX_DEMO_ORDERS_PER_INTERVAL } from "./trading-limits.js";
import type { PauseControl } from "./auto-resume.js";
import { demoExitStateSchema, type DemoExitState } from "./demo-exit-state.js";
import type { ExitPolicy } from "./exit-policy.js";
import { advanceDemoRisk, type DemoRiskState } from "./demo-risk.js";
import { createHash, randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { migrations } from "./migrations.js";
import type {
  PaperCycleResult,
  PaperTraderState,
  PaperTradeClosed,
  PaperTradeOpened,
} from "./paper-trader.js";
import { classifyDemoOrder, normalizedOrderFees, type DemoBuyResult } from "./okx-demo.js";
import { readDemoAccountIdentity } from "./okx-demo-identity.js";
import { isExplicitDemoPermissionRejection } from "./demo-rejection.js";
import type { AiDecision, Candle, QuantSignal } from "./types.js";
import { buildStatisticalReport, type StatisticalTrade } from "./analytics.js";

export type PersistedCycle = {
  symbol: string;
  candle: Candle;
  replayed: boolean;
  paperResult: PaperCycleResult;
  paperState: PaperTraderState;
  riskState?: { consecutiveLosses: number; stopLossCooldownUntil: number };
  lossPause?: { controlRevision?: string };
  decision?: {
    mode: "PAPER" | "PAPER_WITH_OKX_DEMO";
    strategyId?: StrategyId;
    signal: QuantSignal;
    aiDecision: AiDecision;
    approved: boolean;
  };
};

export type RecoveryState = {
  symbol: string;
  lastProcessedCandle: number;
  paperState: PaperTraderState;
  riskState?: { consecutiveLosses: number; stopLossCooldownUntil: number };
};

export type DashboardSettings = {
  symbol: string;
  orderSizeUsdt: number;
  paperTradeSizeUsdt?: number | null;
  maxTrades: number;
  intervalMinutes: number;
  maxConcurrentPositions: number;
};

export type DashboardData = {
  paused: boolean;
  pauseReason?: string | null;
  settings: DashboardSettings;
  demoCycle: Awaited<ReturnType<PostgresPersistence["getDemoCycle"]>>;
  latestDecision: Record<string, unknown> | null;
  latestSnapshot: Record<string, unknown> | null;
  snapshots: Array<Record<string, unknown>>;
  trades: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  metrics: Record<string, unknown>;
  portfoliosBySymbol: Array<Record<string, unknown>>;
  health: Record<string, unknown>;
  analytics: ReturnType<typeof buildStatisticalReport>;
  okxDemo: { quoteFree: number | null; totalUsdt: number | null; updatedAt: string | null; status: string; lastError?: string };
};


export type OperationalEvent = {
  eventType: string;
  severity: "INFO" | "WARN" | "ERROR";
  symbol?: string;
  details?: Record<string, unknown>;
};

export interface BotPersistence {
  isPaused(): Promise<boolean>;
  readControlState?(): Promise<{ paused: boolean; revision: string }>;
  loadRecoveryState?(symbol: string): Promise<RecoveryState | null>;
  setPaused(paused: boolean, actor: string, reason?: string): Promise<void | boolean>;
  recordCycle(cycle: PersistedCycle): Promise<void>;
  recordDemoOrder(
    symbol: string,
    candleTimestamp: number,
    result: DemoBuyResult,
    strategyId?: StrategyId,
  ): Promise<void>;
  recordDemoOrderFailure(
    symbol: string,
    candleTimestamp: number,
    error: string,
    strategyId?: StrategyId,
  ): Promise<void>;
  canPlaceDemoOrder(maxTrades: number, intervalMinutes: number): Promise<boolean>;
  activePairCooldowns?(now: number, policy: PairCooldown): Promise<Array<{ symbol: string; until: number }>>;
  canEnterSymbol?(symbol: string, cooldownMinutes: number): Promise<boolean>;
  recordOperationalEvent(event: OperationalEvent): Promise<void>;
  getDailyStartEquity?(symbol: string): Promise<number | undefined>;
  getDiagnosticLogs?(hours?: number, limit?: number): Promise<string>;
}

type StateRow = {
  last_processed_candle: string;
  state: unknown;
};

type AppliedMigrationRow = {
  version: number;
  name: string;
  checksum: string;
};

function isRiskState(value: unknown): value is { consecutiveLosses: number; stopLossCooldownUntil: number } {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return typeof state.consecutiveLosses === "number" &&
    Number.isFinite(state.consecutiveLosses) &&
    typeof state.stopLossCooldownUntil === "number" &&
    Number.isFinite(state.stopLossCooldownUntil);
}

export class PostgresPersistence implements BotPersistence {
  private readonly pool: Pool;

  constructor(connectionString: string, connectionTimeoutMs = 10_000) {
    this.pool = new Pool({
      connectionString,
      connectionTimeoutMillis: connectionTimeoutMs,
      max: 5,
      application_name: "crypto-bot",
    });
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('crypto-bot-schema-migrations'))",
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      const applied = await client.query<AppliedMigrationRow>(
        "SELECT version, name, checksum FROM schema_migrations",
      );
      const appliedByVersion = new Map(
        applied.rows.map((row) => [row.version, row]),
      );
      for (const migration of migrations) {
        const checksum = createHash("sha256")
          .update(migration.sql)
          .digest("hex");
        const existing = appliedByVersion.get(migration.version);
        if (existing) {
          if (
            existing.name !== migration.name ||
            existing.checksum !== checksum
          ) {
            throw new Error(
              `Applied migration ${migration.version} no longer matches source`,
            );
          }
          continue;
        }
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, checksum],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async startRun(metadata: Record<string, unknown>): Promise<string> {
    const id = randomUUID();
    await this.pool.query(
      "INSERT INTO bot_runs (id, metadata) VALUES ($1, $2::jsonb)",
      [id, JSON.stringify(metadata)],
    );
    return id;
  }

  async stopRun(runId: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE bot_runs
       SET stopped_at = NOW(), stop_reason = $2
       WHERE id = $1 AND stopped_at IS NULL`,
      [runId, reason],
    );
  }

  async loadOpenPaperPositions(): Promise<ManagedPosition[]> {
    const result = await this.pool.query<{ symbol: string; state: PaperTraderState }>(
      "SELECT symbol, state FROM paper_trader_state WHERE jsonb_typeof(state->'position') = 'object'",
    );
    return result.rows.map(({ symbol, state }) => {
      const position = state.position;
      if (!position || !Number.isFinite(position.entryNotional) || position.entryNotional <= 0 || !Number.isSafeInteger(position.entryTimestamp)) {
        throw new Error("Database contains an invalid open Paper position");
      }
      return { symbol, notionalUsdt: position.entryNotional, openedAt: position.entryTimestamp, ...(position.strategyId ? { strategyId: position.strategyId } : {}) };
    });
  }

  async loadRecoveryState(symbol: string): Promise<RecoveryState | null> {
    const result = await this.pool.query<StateRow>(
      `SELECT last_processed_candle, state
       FROM paper_trader_state
       WHERE symbol = $1`,
      [symbol],
    );
    const row = result.rows[0];
    if (!row) return null;

    const lastProcessedCandle = Number(row.last_processed_candle);
    if (!Number.isSafeInteger(lastProcessedCandle) || lastProcessedCandle < 0) {
      throw new Error("Database contains an invalid last_processed_candle");
    }

    const storedState = row.state as PaperTraderState & { symbol?: unknown };
    const { symbol: _storedSymbol, ...paperState } = storedState;
    const recoverySymbol = row.state && typeof row.state === "object" && "symbol" in row.state && typeof row.state.symbol === "string" ? row.state.symbol : symbol;
    const recovery = {
      lastProcessedCandle,
      paperState: paperState as PaperTraderState,
      ...(isRiskState(row.state) ? { riskState: row.state } : {}),
    } as RecoveryState;
    Object.defineProperty(recovery, "symbol", { value: recoverySymbol, enumerable: false });
    return recovery;
  }

  async isPaused(): Promise<boolean> {
    const result = await this.pool.query<{ paused: boolean }>(
      "SELECT paused FROM bot_control WHERE id = 1",
    );
    return result.rows[0]?.paused ?? true;
  }

  async loadPaperResumeStates(): Promise<Array<{ symbol: string; state: PaperTraderState & { consecutiveLosses?: number }; updated_at: Date; last_processed_candle: string; daily_start_equity: number | null }>> {
    const { rows } = await this.pool.query(`
      SELECT t.symbol, t.state, t.updated_at, t.last_processed_candle, daily.equity_usdt AS daily_start_equity
      FROM paper_trader_state t
      LEFT JOIN LATERAL (
        SELECT equity_usdt FROM portfolio_snapshots
        WHERE symbol = t.symbol AND created_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
        ORDER BY created_at ASC, candle_timestamp ASC LIMIT 1
      ) daily ON TRUE`);
    return rows;
  }

  async readControlState(): Promise<PauseControl> {
    const { rows } = await this.pool.query<PauseControl>(
      `SELECT paused, xmin::text AS revision, updated_by AS "updatedBy",
       updated_at AS "updatedAt", pause_reason AS "pauseReason" FROM bot_control WHERE id = 1`,
    );
    return rows[0] ?? { paused: true, revision: "", updatedBy: null, updatedAt: null, pauseReason: null };
  }

  private async writePause(client: PoolClient, paused: boolean, actor: string, reason?: string, expectedRevision?: string): Promise<boolean> {
    const pauseReason = paused ? reason ?? (actor.startsWith("system:") ? actor.slice(7) : null) : null;
    const updated = await client.query(
      `UPDATE bot_control SET paused = $1, updated_at = NOW(), updated_by = $2, pause_reason = $3
       WHERE id = 1 AND (paused IS DISTINCT FROM $1 OR pause_reason IS DISTINCT FROM $3)
         AND ($4::text IS NULL OR xmin::text = $4)
         AND NOT ($1 AND paused AND $2 LIKE 'system:%' AND
           (updated_by IS NOT DISTINCT FROM 'dashboard' OR $2 IN ('system:demo_execution_safety', 'system:demo_exit_supervision', 'system:demo_position_uncertain')))`,
      [paused, actor, pauseReason, expectedRevision ?? null],
    );
    if (updated.rowCount !== 1) return false;
    const details = { paused, ...(pauseReason ? { reason: pauseReason } : {}) };
    await client.query(
      `INSERT INTO audit_events (event_type, actor, details) VALUES ('BOT_PAUSE_CHANGED', $1, $2::jsonb)`,
      [actor, JSON.stringify(details)],
    );
    await client.query(
      `INSERT INTO operational_events (event_type, severity, details) VALUES ('BOT_PAUSED', 'WARN', $1::jsonb)`,
      [JSON.stringify({ ...details, actor })],
    );
    return true;
  }

  async setPaused(paused: boolean, actor: string, reason?: string, expectedRevision?: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const changed = await this.writePause(client, paused, actor, reason, expectedRevision);
      if (changed && !paused && actor === "system:auto_resume") {
        await client.query(`UPDATE paper_trader_state
          SET state = jsonb_set(state, '{consecutiveLosses}', '0'::jsonb)
          WHERE state ? 'consecutiveLosses' AND state->'consecutiveLosses' <> '0'::jsonb`);
      }
      await client.query("COMMIT");
      return changed;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureDashboardSettings(defaults: DashboardSettings): Promise<DashboardSettings> {
    await this.pool.query(
      `INSERT INTO dashboard_settings (
         id, symbol, order_size_usdt, max_trades, interval_minutes, max_concurrent_positions
       ) VALUES (1, $1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [defaults.symbol, defaults.orderSizeUsdt, defaults.maxTrades, defaults.intervalMinutes, defaults.maxConcurrentPositions],
    );
    return this.getDashboardSettings();
  }

  async getDashboardSettings(): Promise<DashboardSettings> {
    const result = await this.pool.query<{
      symbol: string;
      order_size_usdt: number;
      paper_trade_size_usdt: number | null;
      max_trades: number;
      interval_minutes: number;
      max_concurrent_positions: number;
    }>(
      `SELECT symbol, order_size_usdt, paper_trade_size_usdt, max_trades, interval_minutes, max_concurrent_positions
       FROM dashboard_settings WHERE id = 1`,
    );
    const row = result.rows[0];
    if (!row) throw new Error("Dashboard settings are not initialized");
    return {
      symbol: row.symbol,
      orderSizeUsdt: Number(row.order_size_usdt),
      paperTradeSizeUsdt: row.paper_trade_size_usdt === null ? null : Number(row.paper_trade_size_usdt),
      maxTrades: row.max_trades,
      intervalMinutes: row.interval_minutes,
      maxConcurrentPositions: row.max_concurrent_positions,
    };
  }

  async updateDashboardSettings(settings: DashboardSettings, actor: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE dashboard_settings SET
           symbol = $1, order_size_usdt = $2, max_trades = $3,
           interval_minutes = $4, max_concurrent_positions = $5,
           updated_at = NOW(), updated_by = $6,
           paper_trade_size_usdt = CASE WHEN $7::boolean THEN $8::double precision ELSE paper_trade_size_usdt END
         WHERE id = 1`,
        [settings.symbol, settings.orderSizeUsdt, settings.maxTrades, settings.intervalMinutes, settings.maxConcurrentPositions, actor, settings.paperTradeSizeUsdt !== undefined, settings.paperTradeSizeUsdt ?? null],
      );
      await client.query(
        `INSERT INTO audit_events (event_type, actor, details)
        VALUES ('TRADING_SETTINGS_CHANGED', $1, $2::jsonb)`,
        [actor, JSON.stringify(settings)],
      );
      await client.query(
        `INSERT INTO operational_events (event_type, severity, symbol, details)
         VALUES ('TRADING_SETTINGS_CHANGED', 'INFO', $1, $2::jsonb)`,
        [settings.symbol, JSON.stringify({ actor, settings })],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async canPlaceDemoOrder(maxTrades: number, intervalMinutes: number): Promise<boolean> {
    const result = await this.pool.query<{ count: string; pending: boolean }>(
      `SELECT COUNT(*)::text AS count, COALESCE(BOOL_OR(status = 'PENDING'), false) AS pending FROM demo_orders
       WHERE status = 'PENDING' OR (status = 'PLACED'
         AND created_at >= NOW() - ($1 * INTERVAL '1 minute'))`,
      [intervalMinutes],
    );
    return !result.rows[0]?.pending && Number(result.rows[0]?.count ?? 0) < Math.min(maxTrades, MAX_DEMO_ORDERS_PER_INTERVAL);
  }

  async readDemoEntryRevision(): Promise<string> {
    const result = await this.pool.query<{ revision: string }>(
      "SELECT CONCAT(COUNT(*), ':', COUNT(*) FILTER (WHERE status = 'PLACED')) AS revision FROM demo_orders",
    );
    return result.rows[0]!.revision;
  }

  async reserveDemoOrder(symbol: string, timestamp: number, clientOrderId: string, maxTrades = DEFAULT_DEMO_ORDERS_PER_INTERVAL, intervalMinutes = 60, attachedAlgoClientId: string | null = null, expectedEntryRevision?: string, strategyId?: StrategyId): Promise<boolean> {
    if (attachedAlgoClientId !== null && !/^[A-Za-z0-9]{1,32}$/.test(attachedAlgoClientId)) {
      throw new Error("Invalid Demo protection client ID");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('crypto-bot-demo-order-reservation'))");
      const counts = await client.query<{ pending: boolean; recent: string; revision: string }>(
        `SELECT COALESCE(BOOL_OR(status = 'PENDING'), false) AS pending,
          CONCAT(COUNT(*), ':', COUNT(*) FILTER (WHERE status = 'PLACED')) AS revision,
          COUNT(*) FILTER (WHERE status = 'PLACED' AND created_at >= NOW() - ($1 * INTERVAL '1 minute'))::text AS recent
         FROM demo_orders`, [intervalMinutes],
      );
      if ((expectedEntryRevision !== undefined && counts.rows[0]?.revision !== expectedEntryRevision) || counts.rows[0]?.pending || Number(counts.rows[0]?.recent ?? 0) >= Math.min(maxTrades, MAX_DEMO_ORDERS_PER_INTERVAL)) {
        await client.query("COMMIT");
        return false;
      }
      const result = await client.query(
      `INSERT INTO demo_orders (client_order_id, symbol, candle_timestamp, status, result, attached_algo_client_id, strategy_id)
       VALUES ($1, $2, $3, 'PENDING', $4::jsonb, $5, $6)
       ON CONFLICT (client_order_id) DO NOTHING RETURNING client_order_id`,
      [clientOrderId, symbol, timestamp, JSON.stringify({ clientOrderId, status: "PENDING", reason: "submission_unconfirmed" }), attachedAlgoClientId, strategyId ?? null],
      );
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async getDemoBaselineCandidate(): Promise<{ observedAt: Date; balances: Record<string, number>; evidence: Record<string, unknown>; status: string } | null> {
    const result = await this.pool.query<{ observed_at: Date; balances: Record<string, number>; evidence: Record<string, unknown>; status: string }>("SELECT observed_at, balances, evidence, status FROM demo_accounting_baselines WHERE status = 'UNVERIFIED' ORDER BY id DESC LIMIT 1");
    const row = result.rows[0];
    return row ? { observedAt: row.observed_at, balances: row.balances, evidence: row.evidence, status: row.status } : null;
  }

  /** Raw durable intent records: this does not prove exchange acceptance or ownership. */
  async saveDemoBaselineCandidate(input: { observedAt: number; balances: Record<string, number>; evidence: Record<string, unknown> }): Promise<void> {
    if (!readDemoAccountIdentity({ code: "0", data: [input.evidence?.accountIdentity] }) || !Number.isSafeInteger(input.observedAt) || input.observedAt <= 0 || input.observedAt > Date.now() || !input.balances || !Object.hasOwn(input.balances, "USDT") || Object.entries(input.balances).some(([asset, amount]) => !/^[A-Z0-9]+$/.test(asset) || !Number.isFinite(amount) || amount < 0)) throw new Error("Invalid Demo baseline candidate");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('crypto-bot-demo-baseline'))");
      const control = await client.query<{ paused: boolean }>("SELECT paused FROM bot_control WHERE id = 1 FOR UPDATE");
      if (control.rows[0]?.paused !== true) throw new Error("Bot must be paused before recording a baseline");
      const pending = await client.query("SELECT 1 FROM demo_orders WHERE status = 'PENDING' LIMIT 1");
      if (pending.rowCount) throw new Error("Pending Demo orders prevent recording a baseline");
      const existing = await client.query<{ id: string; observed_at: Date; evidence: Record<string, unknown> }>("SELECT id, observed_at, evidence FROM demo_accounting_baselines WHERE status = 'UNVERIFIED' ORDER BY id DESC LIMIT 1 FOR UPDATE");
      if (existing.rows[0]) {
        const previous = existing.rows[0];
        if (previous.evidence?.accountIdentity) throw new Error("Demo baseline candidate already has an account identity");
        const activity = await client.query("SELECT 1 FROM demo_orders WHERE created_at >= $1 LIMIT 1", [previous.observed_at]);
        if (activity.rowCount) throw new Error("Demo order activity prevents replacing the legacy baseline");
        await client.query("UPDATE demo_accounting_baselines SET status = 'SUPERSEDED' WHERE id = $1", [previous.id]);
      }
      await client.query("INSERT INTO demo_accounting_baselines (observed_at, balances, evidence, status) VALUES (to_timestamp($1 / 1000.0), $2::jsonb, $3::jsonb, 'UNVERIFIED')", [input.observedAt, JSON.stringify(input.balances), JSON.stringify(input.evidence)]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async registerDemoExit(clientOrderId: string, algoClientId: string, symbol: string, candle: number, policy: ExitPolicy): Promise<void> {
    const baseline = await this.getDemoBaselineCandidate();
    const state = demoExitStateSchema.parse({ policy, accountIdentity: baseline?.evidence.accountIdentity, lastCandle: candle, highWatermark: 0 });
    const result = await this.pool.query(`INSERT INTO demo_exit_state (algo_client_id,client_order_id,symbol,state)
      SELECT $1,client_order_id,symbol,$4::jsonb FROM demo_orders
      WHERE client_order_id=$2 AND attached_algo_client_id=$1 AND symbol=$3 AND status='PENDING'
      ON CONFLICT DO NOTHING RETURNING algo_client_id`, [algoClientId,clientOrderId,symbol,JSON.stringify(state)]);
    if (result.rowCount !== 1) throw new Error("Exit policy reservation failed");
  }

  async isDemoExitReserved(algoClientId: string, requestId: string, stop: number): Promise<boolean> {
    const result = await this.pool.query(`SELECT 1 FROM demo_exit_state WHERE algo_client_id=$1 AND state->'pending'->>'requestId'=$2 AND (state->'pending'->>'stop')::double precision=$3 AND state->>'closed'='false'`, [algoClientId,requestId,stop]);
    return result.rowCount === 1;
  }

  async managedDemoExits(): Promise<Array<{ algo_client_id: string; client_order_id: string; symbol: string; version: number; state: DemoExitState; result: unknown; status: string; created_at: Date }>> {
    const result = await this.pool.query(`SELECT e.algo_client_id,e.client_order_id,e.symbol,e.version,e.state,o.result,o.status,o.created_at
      FROM demo_exit_state e JOIN demo_orders o ON o.client_order_id=e.client_order_id
      WHERE e.state->>'closed' IS DISTINCT FROM 'true' ORDER BY e.algo_client_id`);
    return result.rows.map(row => ({ ...row, state: demoExitStateSchema.parse(row.state) }));
  }

  async saveDemoExitState(algoClientId: string, version: number, state: DemoExitState): Promise<boolean> {
    const parsed = demoExitStateSchema.parse(state);
    const result = await this.pool.query(`UPDATE demo_exit_state SET state=$3::jsonb,version=version+1,updated_at=NOW()
      WHERE algo_client_id=$1 AND version=$2 RETURNING version`, [algoClientId,version,JSON.stringify(parsed)]);
    return result.rowCount === 1;
  }

  async demoOrderJournal(since?: Date): Promise<Array<{ client_order_id: string; symbol: string; status: string; strategy_id?: StrategyId | null; result: unknown; attached_algo_client_id: string | null; created_at: Date }>> {
    if (since && !Number.isFinite(since.getTime())) throw new Error("Invalid Demo journal start date");
    const result = await this.pool.query<{ client_order_id: string; symbol: string; status: string; strategy_id?: StrategyId | null; result: unknown; attached_algo_client_id: string | null; created_at: Date }>(
      `SELECT client_order_id, symbol, status, strategy_id, result, attached_algo_client_id, created_at
       FROM demo_orders WHERE ($1::timestamptz IS NULL OR created_at >= $1) ORDER BY created_at, client_order_id`,
      [since ?? null],
    );
    return result.rows;
  }

  async pendingDemoOrders(): Promise<Array<{ client_order_id: string; symbol: string }>> {
    const result = await this.pool.query<{ client_order_id: string; symbol: string }>(
      `SELECT client_order_id, symbol FROM demo_orders WHERE status = 'PENDING' ORDER BY created_at LIMIT 100`,
    );
    return result.rows;
  }

  /** Caller must have confirmed the account identity and received OrderNotFound
   * from OKX for this exact client ID. Keep both original rows for audit. */
  async confirmMissingPermissionRejectedOrder(clientOrderId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('crypto-bot-demo-order-reservation'))");
      const pending = await client.query<{ symbol: string; candle_timestamp: string }>("SELECT symbol, candle_timestamp FROM demo_orders WHERE client_order_id = $1 AND status = 'PENDING' FOR UPDATE", [clientOrderId]);
      const row = pending.rows[0];
      if (!row) { await client.query("ROLLBACK"); return false; }
      const failureId = `FAILED:${row.symbol}:${row.candle_timestamp}`;
      const failure = await client.query<{ result: unknown }>("SELECT result FROM demo_orders WHERE client_order_id = $1 AND symbol = $2 AND candle_timestamp = $3 AND status = 'FAILED' FOR UPDATE", [failureId, row.symbol, row.candle_timestamp]);
      if (failure.rows.length !== 1 || !isExplicitDemoPermissionRejection(failure.rows[0]!.result)) { await client.query("ROLLBACK"); return false; }
      await client.query("UPDATE demo_orders SET status = 'REJECTED_CONFIRMED', result = result || $2::jsonb, updated_at = NOW() WHERE client_order_id IN ($1, $3)", [clientOrderId, JSON.stringify({ reconciliation: { method: "okx_50123_and_order_not_found", confirmedAt: new Date().toISOString() } }), failureId]);
      await client.query("INSERT INTO audit_events (event_type, actor, details) VALUES ('DEMO_REJECTION_RECONCILED', 'system', $1::jsonb)", [JSON.stringify({ clientOrderId, failureId, symbol: row.symbol, method: "okx_50123_and_order_not_found" })]);
      await client.query("COMMIT");
      return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async reconcileDemoOrder(clientOrderId: string, order: { id?: string | undefined; status?: string | undefined; filled?: number | undefined; average?: number | undefined; cost?: number | undefined; side?: string | undefined; fee?: { currency?: string | undefined; cost?: number | undefined } | undefined; fees?: Array<{ currency?: string | undefined; cost?: number | undefined }> | undefined }): Promise<void> {
    const status = classifyDemoOrder(order.status, order.filled);
    await this.pool.query(
      `UPDATE demo_orders SET status = $2, result = result || $3::jsonb, updated_at = NOW() WHERE client_order_id = $1 AND status = 'PENDING'`,
      [clientOrderId, status, JSON.stringify({ orderId: order.id ?? null, orderStatus: order.status ?? null, filled: order.filled ?? null, average: order.average ?? null, cost: order.cost ?? null, ...(order.side ? { side: order.side } : {}), ...(order.fee || order.fees?.length ? { fees: normalizedOrderFees(order) } : {}), feesPresentOnTerminalResponse: status !== "PENDING" && normalizedOrderFees(order).length > 0, confirmed: status === "PLACED", reconciledAt: new Date().toISOString() })],
    );
  }

  async startDemoCycle(expectedStart: string | null): Promise<string | null> {
    const result = await this.pool.query<{ cycle_started_at: Date }>(`
      WITH started AS (
        UPDATE dashboard_settings
        SET cycle_started_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), cycle_started_at + INTERVAL '1 millisecond')
        WHERE id = 1 AND cycle_started_at IS NOT DISTINCT FROM $1::timestamptz
        RETURNING cycle_started_at
      ), audit AS (
        INSERT INTO operational_events (event_type, severity, details)
        SELECT 'DEMO_CYCLE_STARTED', 'INFO', jsonb_build_object('actor', 'dashboard', 'cycleStartedAt', cycle_started_at)
        FROM started
      )
      SELECT cycle_started_at FROM started`, [expectedStart]);
    return result.rows[0]?.cycle_started_at.toISOString() ?? null;
  }

  async getDemoCycle() {
    const result = await this.pool.query<{
      cycle_started_at: Date | null; confirmed_through: Date | null; closed: number;
      wins: number; gains: number; losses: number; recent: number[];
    }>(`
      WITH settings AS (
        SELECT cycle_started_at FROM dashboard_settings WHERE id = 1
      ), baseline AS (
        SELECT observed_at, CONCAT_WS(':', evidence->'accountIdentity'->>'mainUid',
          evidence->'accountIdentity'->>'uid') AS account_id
        FROM demo_accounting_baselines WHERE status = 'UNVERIFIED'
        ORDER BY id DESC LIMIT 1
      ), eligible AS (
        SELECT t.net_pnl_usdt, t.closed_at, t.buy_order_id
        FROM demo_closed_trades t JOIN baseline b USING (account_id)
        CROSS JOIN settings s WHERE t.opened_at >= s.cycle_started_at
      ), totals AS (
        SELECT COUNT(*)::int AS closed, COUNT(*) FILTER (WHERE net_pnl_usdt > 0)::int AS wins,
          COALESCE(SUM(GREATEST(net_pnl_usdt, 0)), 0) AS gains,
          COALESCE(SUM(GREATEST(-net_pnl_usdt, 0)), 0) AS losses FROM eligible
      ), recent AS (
        SELECT net_pnl_usdt, closed_at, buy_order_id FROM eligible
        ORDER BY closed_at DESC, buy_order_id DESC LIMIT $1
      )
      SELECT s.cycle_started_at, totals.*,
        (SELECT MAX(c.observed_at) FROM demo_accounting_checkpoints c JOIN baseline b ON c.baseline_at = b.observed_at
          WHERE c.observed_at >= s.cycle_started_at) AS confirmed_through,
        ARRAY(SELECT net_pnl_usdt FROM recent ORDER BY closed_at, buy_order_id) AS recent
      FROM settings s CROSS JOIN totals`, [EDGE_SAMPLE_SIZE]);
    const row = result.rows[0];
    if (!row?.cycle_started_at) return null;
    return {
      cycleStartedAt: row.cycle_started_at.toISOString(), confirmedThrough: row.confirmed_through?.toISOString() ?? null,
      closedTrades: row.closed, netPnlUsdt: row.gains - row.losses,
      winRatePercent: row.closed ? row.wins / row.closed * 100 : null,
      profitFactor: profitFactor(row.gains, row.losses),
      rolling: { ...rollingDemoEdge(row.recent), minimumTrades: EDGE_SAMPLE_SIZE, threshold: EDGE_THRESHOLD },
    };
  }

  private async recordConfirmedDemoTrades(client: PoolClient, accountId: string, closedTrades: ConfirmedDemoTrade[]): Promise<void> {
    const settings = await client.query<{ cycle_started_at: Date | null }>(
      "SELECT cycle_started_at FROM dashboard_settings WHERE id = 1 FOR UPDATE");
    const start = settings.rows[0]?.cycle_started_at;
    type Close = { buy_order_id: string; opened_at: Date; closed_at: Date; net_pnl_usdt: number };
    const recent = async () => (await client.query<Close>(`
      SELECT buy_order_id, opened_at, closed_at, net_pnl_usdt FROM demo_closed_trades
      WHERE account_id = $1 AND opened_at >= $2 ORDER BY closed_at DESC, buy_order_id DESC LIMIT $3
    `, [accountId, start, EDGE_SAMPLE_SIZE])).rows.reverse();

    const before = start ? await recent() : [];
    const inserted = await client.query<Close>(`
      INSERT INTO demo_closed_trades (account_id, buy_order_id, opened_at, closed_at, net_pnl_usdt)
      SELECT $1, t."buyOrderId", to_timestamp(t."openedAt" / 1000.0),
        to_timestamp(t."closedAt" / 1000.0), t."netPnlUsdt"
      FROM jsonb_to_recordset($2::jsonb) AS t("buyOrderId" text, "openedAt" bigint, "closedAt" bigint, "netPnlUsdt" double precision)
      ON CONFLICT (account_id, buy_order_id) DO NOTHING
      RETURNING buy_order_id, opened_at, closed_at, net_pnl_usdt
    `, [accountId, JSON.stringify(closedTrades)]);
    if (!start) return;
    const newEligible = inserted.rows.filter(row => row.opened_at >= start);
    if (!newEligible.length) return;

    const compare = (a: Close, b: Close) => a.closed_at.getTime() - b.closed_at.getTime() ||
      (a.buy_order_id < b.buy_order_id ? -1 : Number(a.buy_order_id > b.buy_order_id));
    const anchor = before.at(-1);
    let degraded = rollingDemoEdge(before.map(row => row.net_pnl_usdt)).degraded;
    const check = async (sample: number[], closedAt: Date) => {
      const current = rollingDemoEdge(sample);
      if (current.degraded && !degraded) {
        await client.query(`INSERT INTO operational_events (event_type, severity, details)
          VALUES ('EDGE_DEGRADATION', 'WARN', $1::jsonb)`,
        [JSON.stringify({ cycleStartedAt: start, closedAt, ...current, threshold: EDGE_THRESHOLD })]);
      }
      degraded = current.degraded;
    };
    const sample: number[] = [];
    const ordered = [...before, ...newEligible].sort(compare);
    for (const row of ordered) {
      sample.push(row.net_pnl_usdt);
      if (sample.length > EDGE_SAMPLE_SIZE) sample.shift();
      if (!anchor || compare(row, anchor) > 0) await check(sample, row.closed_at);
    }
    // A late arrival may change the latest window without advancing the latest exchange close.
    if (anchor && compare(ordered.at(-1)!, anchor) === 0) await check(sample, anchor.closed_at);
  }

  async getDemoAccountingCheckpoint(baselineAt: Date): Promise<{ observedAt: Date; balances: Record<string, number>; evidence: Record<string, unknown>; status: string; realizedPnlOffset: number } | null> {
    const result = await this.pool.query("SELECT * FROM demo_accounting_checkpoints WHERE baseline_at = $1 ORDER BY observed_at DESC LIMIT 1", [baselineAt]);
    const row = result.rows[0];
    return row ? { observedAt: row.observed_at, balances: row.balances, evidence: row.evidence, status: "UNVERIFIED", realizedPnlOffset: Number(row.realized_pnl) } : null;
  }

  /** Commit a reconciled observation only if its predecessor and order journal remain current. */
  async saveDemoAccountingCheckpoint(input: { baselineAt: Date; observedAt: number; balances: Record<string, number>; evidence: Record<string, unknown>; realizedPnl: number; previousObservedAt?: number; closedTrades?: ConfirmedDemoTrade[] }): Promise<boolean> {
    if (!Number.isSafeInteger(input.observedAt) || input.observedAt <= input.baselineAt.getTime() || !Number.isFinite(input.realizedPnl)) throw new Error("Invalid Demo checkpoint");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('crypto-bot-demo-order-reservation'))");
      const latest = await client.query<{ observed_at: Date }>("SELECT observed_at FROM demo_accounting_checkpoints WHERE baseline_at = $1 ORDER BY observed_at DESC LIMIT 1", [input.baselineAt]);
      const predecessor = latest.rows[0]?.observed_at.getTime() ?? input.baselineAt.getTime();
      if (predecessor >= input.observedAt || (input.previousObservedAt !== undefined && predecessor !== input.previousObservedAt)) { await client.query("ROLLBACK"); return false; }
      const changed = await client.query("SELECT 1 FROM demo_orders WHERE status = 'PENDING' OR updated_at > to_timestamp($1 / 1000.0) LIMIT 1", [input.observedAt]);
      if (changed.rows.length) { await client.query("ROLLBACK"); return false; }
      await client.query(`INSERT INTO demo_accounting_checkpoints (baseline_at, observed_at, balances, evidence, realized_pnl)
        VALUES ($1, to_timestamp($2 / 1000.0), $3::jsonb, $4::jsonb, $5)
        ON CONFLICT (baseline_at, observed_at) DO NOTHING`,
        [input.baselineAt, input.observedAt, JSON.stringify(input.balances), JSON.stringify(input.evidence), input.realizedPnl]);
      if (input.closedTrades?.length) {
        const identity = readDemoAccountIdentity({ code: "0", data: [input.evidence.accountIdentity] });
        if (!identity) throw new Error("Missing account identity for confirmed Demo trades");
        await this.recordConfirmedDemoTrades(client, `${identity.mainUid}:${identity.uid}`, input.closedTrades);
      }
      await client.query("COMMIT");
      return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async latestDemoReconciliation(): Promise<{ confirmedThrough: string; realizedPnlUsdt: number } | null> {
    const result = await this.pool.query("SELECT c.observed_at, c.realized_pnl FROM demo_accounting_checkpoints c JOIN demo_accounting_baselines b ON b.observed_at = c.baseline_at WHERE b.status = 'UNVERIFIED' ORDER BY c.observed_at DESC LIMIT 1");
    const row = result.rows[0];
    return row ? { confirmedThrough: row.observed_at.toISOString(), realizedPnlUsdt: Number(row.realized_pnl) } : null;
  }

  async latestDemoDecision(): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query("SELECT details, created_at FROM operational_events WHERE event_type = 'DEMO_ENTRY_DECISION' ORDER BY created_at DESC LIMIT 1");
    return result.rows[0] ?? null;
  }

  async observeDemoRisk(accountId: string, equity: number, observedAt: number): Promise<DemoRiskState> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`demo-risk:${accountId}`]);
      const result = await client.query<{ state: DemoRiskState }>("SELECT state FROM demo_risk_state WHERE account_id = $1 FOR UPDATE", [accountId]);
      const state = advanceDemoRisk(result.rows[0]?.state ?? null, equity, observedAt);
      await client.query("INSERT INTO demo_risk_state (account_id, state) VALUES ($1, $2::jsonb) ON CONFLICT (account_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()", [accountId, JSON.stringify(state)]);
      await client.query("COMMIT");
      return state;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async canEnterDemoSymbol(symbol: string, cooldownMinutes: number): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM demo_orders WHERE symbol = $1 AND
       (status = 'PENDING' OR (status = 'PLACED' AND created_at >= NOW() - ($2 * INTERVAL '1 minute'))) LIMIT 1`,
      [symbol, cooldownMinutes],
    );
    return result.rows.length === 0;
  }

  async activePairCooldowns(now: number, policy: PairCooldown): Promise<Array<{ symbol: string; until: number }>> {
    const result = await this.pool.query<{ symbol: string; candle_timestamp: string; pnl: number }>(
      `SELECT symbol, candle_timestamp, pnl FROM (
         SELECT symbol, candle_timestamp, (trade->>'netPnlUsdt')::double precision AS pnl,
           row_number() OVER (PARTITION BY symbol ORDER BY candle_timestamp DESC, event_key DESC) AS rank
         FROM paper_trades WHERE event_type = 'CLOSED' AND candle_timestamp BETWEEN $1 AND $2
       ) AS recent WHERE rank <= $3 ORDER BY symbol, rank`,
      [now - PAIR_COOLDOWN_LOOKBACK_MS - policy.hours * HOUR_MS - REGIME_CANDLE_MS, now - REGIME_CANDLE_MS, policy.minLosses],
    );
    const bySymbol = new Map<string, Array<{ closedAt: number; netPnlUsdt: number }>>();
    for (const row of result.rows) {
      const trades = bySymbol.get(row.symbol) ?? [];
      trades.push({ closedAt: Number(row.candle_timestamp) + REGIME_CANDLE_MS, netPnlUsdt: row.pnl });
      bySymbol.set(row.symbol, trades);
    }
    return [...bySymbol].flatMap(([symbol, trades]) => {
      const until = pairCooldownUntil(trades, now, policy);
      return until === undefined ? [] : [{ symbol, until }];
    });
  }

  async canEnterSymbol(symbol: string, cooldownMinutes: number): Promise<boolean> {
    const result = await this.pool.query<{ last_trade: Date | null }>(
      `SELECT MAX(to_timestamp((trade->>
         CASE WHEN event_type = 'CLOSED' THEN 'exitTimestamp' ELSE 'entryTimestamp' END
       )::double precision / 1000)) AS last_trade
       FROM paper_trades
       WHERE symbol = $1
         AND to_timestamp((trade->>
           CASE WHEN event_type = 'CLOSED' THEN 'exitTimestamp' ELSE 'entryTimestamp' END
         )::double precision / 1000) >= NOW() - ($2 * INTERVAL '1 minute')`,
      [symbol, cooldownMinutes],
    );
    return !result.rows[0]?.last_trade;
  }

  async recordOperationalEvent(event: OperationalEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO operational_events (event_type, severity, symbol, details)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [event.eventType, event.severity, event.symbol ?? null, JSON.stringify(event.details ?? {})],
    );
  }

  async getDiagnosticLogs(hours = 6, limit = 500): Promise<string> {
    const safeHours = Number.isFinite(hours) ? Math.min(2160, Math.max(1, Math.trunc(hours))) : 6;
    const safeLimit = Number.isFinite(limit) ? Math.min(500, Math.max(50, Math.trunc(limit))) : 500;
    const [events, decisions, trades, orders] = await Promise.all([
      this.pool.query(`SELECT created_at, event_type, severity, symbol, details FROM operational_events WHERE created_at >= NOW() - ($1 * INTERVAL '1 hour') ORDER BY created_at DESC LIMIT $2`, [safeHours, safeLimit]),
      this.pool.query(`SELECT created_at, symbol, candle_timestamp, mode, signal, ai_decision, approved, strategy_id FROM decisions WHERE created_at >= NOW() - ($1 * INTERVAL '1 hour') ORDER BY created_at DESC LIMIT $2`, [safeHours, safeLimit]),
      this.pool.query(`SELECT created_at, symbol, candle_timestamp, event_type, trade, trade->>'strategyId' AS strategy_id FROM paper_trades WHERE created_at >= NOW() - ($1 * INTERVAL '1 hour') ORDER BY created_at DESC LIMIT $2`, [safeHours, safeLimit]),
      this.pool.query(`SELECT created_at, updated_at, client_order_id, symbol, candle_timestamp, status, result, strategy_id FROM demo_orders WHERE created_at >= NOW() - ($1 * INTERVAL '1 hour') ORDER BY created_at DESC LIMIT $2`, [safeHours, safeLimit]),
    ]);
    const lines = [
      { section: "operational_events", rows: events.rows },
      { section: "decisions", rows: decisions.rows },
      { section: "paper_trades", rows: trades.rows },
      { section: "demo_orders", rows: orders.rows },
    ].flatMap(({ section, rows }) => rows.map((row) => JSON.stringify({ section, ...row })));
    return JSON.stringify({ generatedAt: new Date().toISOString(), scope: { hours: safeHours, maxRowsPerSection: safeLimit, sectionsAtLimit: [{ name: "operational_events", count: events.rows.length }, { name: "decisions", count: decisions.rows.length }, { name: "paper_trades", count: trades.rows.length }, { name: "demo_orders", count: orders.rows.length }].filter((section) => section.count === safeLimit).map((section) => section.name) }, records: lines.map((line) => JSON.parse(line)) }, null, 2);
  }

  async getDailyStartEquity(symbol: string): Promise<number | undefined> {
    const result = await this.pool.query<{ equity_usdt: number }>(
      `SELECT equity_usdt FROM portfolio_snapshots
       WHERE symbol = $1 AND created_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
       ORDER BY created_at ASC LIMIT 1`,
      [symbol],
    );
    const equity = result.rows[0]?.equity_usdt;
    return equity === undefined ? undefined : Number(equity);
  }

  async getDashboardData(limit = 40, historySymbol?: string, paperSince?: number): Promise<DashboardData> {
    const settings = await this.getDashboardSettings();
    const [control, decision, snapshot, snapshots, trades, orders, decisionMetrics, tradeMetrics, eventMetrics, serviceEvents, portfolioRows, periodPnl, analyticsTrades, okxEvents, demoCycle] = await Promise.all([
      this.pool.query<{ paused: boolean; pause_reason: string | null }>("SELECT paused, pause_reason FROM bot_control WHERE id = 1"),
      this.pool.query<Record<string, unknown>>(
        `SELECT symbol, candle_timestamp, mode, signal, ai_decision, approved, strategy_id, created_at
         FROM decisions WHERE symbol = $1 ORDER BY created_at DESC LIMIT 1`,
        [settings.symbol],
      ),
      this.pool.query<Record<string, unknown>>(
        `SELECT symbol, candle_timestamp, snapshot, created_at
         FROM portfolio_snapshots WHERE symbol = $1 ORDER BY created_at DESC LIMIT 1`,
        [settings.symbol],
      ),
      this.pool.query<Record<string, unknown>>(
        `SELECT symbol, candle_timestamp, equity_usdt, realized_pnl_usdt,
                current_drawdown_percent, snapshot, created_at
         FROM portfolio_snapshots WHERE symbol = $1 ORDER BY created_at DESC LIMIT $2`,
        [settings.symbol, limit],
      ),
      this.pool.query<Record<string, unknown>>(
        `SELECT symbol, event_type, candle_timestamp, trade, created_at
         FROM paper_trades
         WHERE ($1::text IS NULL OR symbol = $1)
         ORDER BY created_at DESC LIMIT $2`,
        [historySymbol ?? null, limit],
      ),
      this.pool.query<Record<string, unknown>>(
        `SELECT client_order_id, symbol, status, result, strategy_id, created_at
         FROM demo_orders
         WHERE ($1::text IS NULL OR symbol = $1)
         ORDER BY created_at DESC LIMIT $2`,
        [historySymbol ?? null, limit],
      ),
      this.pool.query<Record<string, unknown>>(
        `SELECT COUNT(*)::int AS decisions,
                COUNT(*) FILTER (WHERE approved)::int AS approved,
                COUNT(*) FILTER (WHERE NOT approved)::int AS rejected
         FROM decisions WHERE symbol = $1`,
        [settings.symbol],
      ),
      this.pool.query<Record<string, unknown>>(
        `SELECT COUNT(*) FILTER (WHERE event_type = 'OPENED')::int AS entries,
                COUNT(*) FILTER (WHERE event_type = 'CLOSED')::int AS exits,
                COUNT(*) FILTER (WHERE event_type = 'CLOSED' AND (trade->>'netPnlUsdt')::double precision > 0)::int AS wins,
                COALESCE(SUM((trade->>'netPnlUsdt')::double precision) FILTER (WHERE event_type = 'CLOSED'), 0)::double precision AS net_pnl
         FROM paper_trades WHERE symbol = $1`,
        [settings.symbol],
      ),
      this.pool.query<Record<string, unknown>>(
        `SELECT COUNT(*) FILTER (WHERE severity = 'ERROR')::int AS errors,
                MAX(created_at) AS last_event_at
         FROM operational_events`,
      ),
      this.pool.query<{ service: string; status: string }>(
        `SELECT DISTINCT ON (details->>'service')
                details->>'service' AS service, details->>'status' AS status
         FROM operational_events
         WHERE event_type = 'SERVICE_STATUS'
         ORDER BY details->>'service', created_at DESC`,
      ),
      this.pool.query<Record<string, unknown>>(
        `SELECT DISTINCT ON (symbol) symbol, snapshot, created_at
         FROM portfolio_snapshots ORDER BY symbol, created_at DESC`,
      ),
      this.pool.query<Record<string, unknown>>(
        `SELECT
           COALESCE(SUM((trade->>'netPnlUsdt')::double precision) FILTER (WHERE event_type = 'CLOSED' AND to_timestamp((trade->>'exitTimestamp')::double precision / 1000) >= date_trunc('day', NOW())), 0)::double precision AS daily,
           COALESCE(SUM((trade->>'netPnlUsdt')::double precision) FILTER (WHERE event_type = 'CLOSED' AND to_timestamp((trade->>'exitTimestamp')::double precision / 1000) >= date_trunc('week', NOW())), 0)::double precision AS weekly,
           COALESCE(SUM((trade->>'netPnlUsdt')::double precision) FILTER (WHERE event_type = 'CLOSED' AND to_timestamp((trade->>'exitTimestamp')::double precision / 1000) >= date_trunc('month', NOW())), 0)::double precision AS monthly
         FROM paper_trades`,
      ),
      this.pool.query<Record<string, unknown>>(`SELECT pt.symbol, pt.trade, d.signal, d.ai_decision FROM paper_trades pt LEFT JOIN LATERAL (SELECT signal, ai_decision FROM decisions WHERE decisions.symbol = pt.symbol AND decisions.candle_timestamp = (pt.trade->>'entryTimestamp')::bigint ORDER BY decisions.created_at DESC LIMIT 1) d ON TRUE WHERE pt.event_type = 'CLOSED'`),
      this.pool.query<Record<string, unknown>>(`SELECT event_type, severity, details, created_at FROM operational_events WHERE details->>'service' = 'okx-demo' ORDER BY created_at DESC LIMIT 20`),
      this.getDemoCycle(),
    ]);
    const decisionRow = decisionMetrics.rows[0] ?? {};
    const tradeRow = tradeMetrics.rows[0] ?? {};
    const eventRow = eventMetrics.rows[0] ?? {};
    const latestSnapshot = snapshot.rows[0]?.snapshot as Record<string, unknown> | undefined;
    const aggregateSnapshot = portfolioRows.rows.reduce<Record<string, unknown>>((aggregate, row) => {
      const current = (row.snapshot ?? {}) as Record<string, unknown>;
      for (const key of ["equityUsdt", "realizedPnlUsdt", "unrealizedPnlUsdt", "totalFeesUsdt"])
        aggregate[key] = Number(aggregate[key] ?? 0) + Number(current[key] ?? 0);
      aggregate.closedTrades = Number(aggregate.closedTrades ?? 0) + Number(current.closedTrades ?? 0);
      aggregate.wins = Number(aggregate.wins ?? 0) + Number(current.wins ?? 0);
      aggregate.losses = Number(aggregate.losses ?? 0) + Number(current.losses ?? 0);
      aggregate.currentDrawdownPercent = Math.max(Number(aggregate.currentDrawdownPercent ?? 0), Number(current.currentDrawdownPercent ?? 0));
      aggregate.maxDrawdownPercent = Math.max(Number(aggregate.maxDrawdownPercent ?? 0), Number(current.maxDrawdownPercent ?? 0));
      aggregate.buyAndHoldReturnPercent = Number(aggregate.buyAndHoldReturnPercent ?? 0) + Number(current.buyAndHoldReturnPercent ?? 0);
      return aggregate;
    }, {});
    const portfolioCount = portfolioRows.rows.length || 1;
    const totalEquity = Number(aggregateSnapshot.equityUsdt ?? 0);
    const totalPositionValue = portfolioRows.rows.reduce((sum, row) => sum + Number(((row.snapshot ?? {}) as Record<string, unknown>).positionMarketValueUsdt ?? 0), 0);
    const periodRow = periodPnl.rows[0] ?? {};
    const periodMetrics = Object.fromEntries(["daily", "weekly", "monthly"].map((period) => {
      const value = Number(periodRow[period] ?? 0);
      return [period, { usdt: value, percent: totalEquity ? (value / totalEquity) * 100 : 0 }];
    }));
    aggregateSnapshot.strategyReturnPercent = Number(aggregateSnapshot.equityUsdt ?? 0) / (portfolioCount * 1000) * 100 - 100;
    aggregateSnapshot.buyAndHoldReturnPercent = Number(aggregateSnapshot.buyAndHoldReturnPercent ?? 0) / portfolioCount;
    aggregateSnapshot.excessReturnVsBuyAndHoldPercent = Number(aggregateSnapshot.strategyReturnPercent) - Number(aggregateSnapshot.buyAndHoldReturnPercent);
    const latestCycleAt = snapshot.rows[0]?.created_at ?? null;
    const health = Object.fromEntries(serviceEvents.rows.map((row) => [row.service, row.status]));
    health.postgresql ??= "ok";
    const statisticalTrades: (StatisticalTrade & { entryTimestamp: number })[] = analyticsTrades.rows.map((row) => {
      const trade = (row.trade ?? {}) as Record<string, unknown>;
      const exitTimestamp = Number(trade.exitTimestamp ?? 0);
      const entryTimestamp = Number(trade.entryTimestamp ?? 0);
      const signal = (row.signal ?? {}) as Record<string, unknown>;
      const breakdown = (signal.scoreBreakdown ?? {}) as Record<string, unknown>;
      const aiReason = String((row.ai_decision as Record<string, unknown> | undefined)?.reason ?? "");
      const trend = Number(breakdown.trend ?? 0); const volatility = Number(signal.volatilityPercent ?? 0);
      return { symbol: String(row.symbol), netPnlUsdt: Number(trade.netPnlUsdt ?? 0), entryTimestamp, exitTimestamp, regime: Math.abs(trend) >= 2 ? "trend" : volatility > 2 ? "volatile" : "lateral", aiState: aiReason.includes("UNAVAILABLE") ? "AI_UNAVAILABLE" : aiReason.includes("disabled") ? "AI_DISABLED" : "AI_AVAILABLE" };
    });
    const lifetime = buildStatisticalReport(statisticalTrades);
    const analytics = paperSince === undefined ? lifetime : buildStatisticalReport(
      // A trade opened before the selected date belongs to the prior experiment.
      statisticalTrades.filter((trade) => trade.entryTimestamp >= paperSince),
    );
    const closedTrades = lifetime.trades;
    const wins = lifetime.wins;
    return {
      paused: control.rows[0]?.paused ?? true,
      pauseReason: control.rows[0]?.pause_reason ?? null,
      settings,
      demoCycle,
      latestDecision: decision.rows[0] ?? null,
      latestSnapshot: snapshot.rows[0] ? { ...snapshot.rows[0], snapshot: { ...latestSnapshot, ...aggregateSnapshot } } : null,
      snapshots: snapshots.rows.reverse(),
      portfoliosBySymbol: portfolioRows.rows,
      trades: trades.rows,
      orders: orders.rows,
      metrics: {
        decisions: Number(decisionRow.decisions ?? 0),
        approvedDecisions: Number(decisionRow.approved ?? 0),
        rejectedDecisions: Number(decisionRow.rejected ?? 0),
        entries: Number(tradeRow.entries ?? 0),
        exits: Number(tradeRow.exits ?? 0),
        closedTrades,
        wins,
        losses: Math.max(0, closedTrades - wins),
        winRate: closedTrades ? (wins / closedTrades) * 100 : 0,
        netPnlUsdt: lifetime.netPnlUsdt,
        feesUsdt: Number(latestSnapshot?.totalFeesUsdt ?? 0),
        currentDrawdownPercent: Number(latestSnapshot?.currentDrawdownPercent ?? 0),
        maxDrawdownPercent: Number(aggregateSnapshot.maxDrawdownPercent ?? 0),
        lastCycleAt: latestCycleAt,
        secondsSinceLastCycle: latestCycleAt ? Math.max(0, (Date.now() - new Date(String(latestCycleAt)).getTime()) / 1000) : null,
        buyAndHoldReturnPercent: Number(latestSnapshot?.buyAndHoldReturnPercent ?? 0),
        strategyReturnPercent: Number(latestSnapshot?.strategyReturnPercent ?? 0),
        excessReturnVsBuyAndHoldPercent: Number(latestSnapshot?.excessReturnVsBuyAndHoldPercent ?? 0),
        errorCount: Number(eventRow.errors ?? 0),
        periodPnl: periodMetrics,
        totalPositionValueUsdt: totalPositionValue,
        totalPositionValuePercent: totalEquity ? (totalPositionValue / totalEquity) * 100 : 0,
      },
      health: { ...health, lastOperationalEventAt: eventRow.last_event_at ?? null },
      analytics,
      okxDemo: (() => {
        const event = okxEvents.rows.find((row) => (row.details as Record<string, unknown> | undefined)?.balance) ?? okxEvents.rows.find((row) => (row.details as Record<string, unknown> | undefined)?.status === "ok");
        const details = (event?.details ?? {}) as Record<string, unknown>;
        const balance = (details.balance ?? {}) as Record<string, unknown>;
        const errorEvent = okxEvents.rows.find((row) => row.severity === "ERROR");
        return { quoteFree: Number.isFinite(Number(balance.quoteFree)) ? Number(balance.quoteFree) : null, totalUsdt: Number.isFinite(Number(balance.totalUsdt)) ? Number(balance.totalUsdt) : null, updatedAt: event?.created_at ? String(event.created_at) : null, status: String(details.status ?? "unknown"), ...(errorEvent ? { lastError: String(((errorEvent.details ?? {}) as Record<string, unknown>).error ?? "") } : {}) };
      })(),
    };
  }

  async recordCycle(cycle: PersistedCycle): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (cycle.lossPause) await client.query("SELECT id FROM bot_control WHERE id = 1 FOR UPDATE");
      if (cycle.decision) await this.upsertDecision(client, cycle);
      await this.upsertSnapshot(client, cycle);
      for (const trade of cycle.paperResult.events) {
        await this.upsertPaperTrade(client, cycle, trade);
      }
      const checkpoint = await client.query(
        `INSERT INTO paper_trader_state (
           symbol, last_processed_candle, state
         ) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (symbol) DO UPDATE SET
           last_processed_candle = EXCLUDED.last_processed_candle,
           state = EXCLUDED.state,
           updated_at = NOW()
         WHERE paper_trader_state.last_processed_candle <=
           EXCLUDED.last_processed_candle
         RETURNING last_processed_candle`,
        [
          cycle.symbol,
          cycle.candle.timestamp,
           JSON.stringify({ symbol: cycle.symbol, ...cycle.paperState, ...(cycle.riskState ?? {}) }),
        ],
      );
      if (checkpoint.rowCount !== 1) {
        throw new Error("Refusing to overwrite a newer portfolio checkpoint");
      }
      if (cycle.lossPause) {
        await this.writePause(client, true, "system:consecutive_losses", undefined, cycle.lossPause.controlRevision);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordDemoOrder(
    symbol: string,
    candleTimestamp: number,
    result: DemoBuyResult,
    strategyId?: StrategyId,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO demo_orders (
         client_order_id, symbol, candle_timestamp, status, result, strategy_id
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (client_order_id) DO UPDATE SET
         status = EXCLUDED.status,
         result = EXCLUDED.result,
         strategy_id = COALESCE(demo_orders.strategy_id, EXCLUDED.strategy_id),
         updated_at = NOW()
       WHERE (EXCLUDED.status <> 'SKIPPED' OR demo_orders.status NOT IN ('PENDING', 'PLACED'))
         AND NOT (EXCLUDED.status = 'PENDING' AND demo_orders.status IN ('PLACED', 'FAILED'))
         AND demo_orders.status <> 'REJECTED_CONFIRMED'`,
      [
        result.clientOrderId,
        symbol,
        candleTimestamp,
        result.status,
        JSON.stringify(result),
        strategyId ?? null,
      ],
    );
  }

  async recordDemoOrderFailure(
    symbol: string,
    candleTimestamp: number,
    error: string,
    strategyId?: StrategyId,
  ): Promise<void> {
    const clientOrderId = `FAILED:${symbol}:${candleTimestamp}`;
    await this.pool.query(
      `INSERT INTO demo_orders (
         client_order_id, symbol, candle_timestamp, status, result, strategy_id
       ) VALUES ($1, $2, $3, 'FAILED', $4::jsonb, $5)
       ON CONFLICT (client_order_id) DO UPDATE SET
         result = EXCLUDED.result,
         updated_at = NOW()
       WHERE demo_orders.status <> 'REJECTED_CONFIRMED'`,
      [clientOrderId, symbol, candleTimestamp, JSON.stringify({ error }), strategyId ?? null],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async upsertDecision(
    client: PoolClient,
    cycle: PersistedCycle,
  ): Promise<void> {
    const decision = cycle.decision!;
    await client.query(
      `INSERT INTO decisions (
         symbol, candle_timestamp, mode, signal, ai_decision, approved, strategy_id
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
       ON CONFLICT (symbol, candle_timestamp) DO UPDATE SET
         mode = EXCLUDED.mode,
         signal = EXCLUDED.signal,
         ai_decision = EXCLUDED.ai_decision,
         approved = EXCLUDED.approved,
         strategy_id = EXCLUDED.strategy_id,
         updated_at = NOW()`,
      [
        cycle.symbol,
        cycle.candle.timestamp,
        decision.mode,
        JSON.stringify(decision.signal),
        JSON.stringify(decision.aiDecision),
        decision.approved,
        decision.strategyId ?? null,
      ],
    );
  }

  private async upsertSnapshot(
    client: PoolClient,
    cycle: PersistedCycle,
  ): Promise<void> {
    const snapshot = cycle.paperResult.snapshot;
    await client.query(
      `INSERT INTO portfolio_snapshots (
         symbol, candle_timestamp, replayed, equity_usdt,
         realized_pnl_usdt, unrealized_pnl_usdt,
         current_drawdown_percent, max_drawdown_percent, snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (symbol, candle_timestamp) DO UPDATE SET
         replayed = EXCLUDED.replayed,
         equity_usdt = EXCLUDED.equity_usdt,
         realized_pnl_usdt = EXCLUDED.realized_pnl_usdt,
         unrealized_pnl_usdt = EXCLUDED.unrealized_pnl_usdt,
         current_drawdown_percent = EXCLUDED.current_drawdown_percent,
         max_drawdown_percent = EXCLUDED.max_drawdown_percent,
         snapshot = EXCLUDED.snapshot`,
      [
        cycle.symbol,
        cycle.candle.timestamp,
        cycle.replayed,
        snapshot.equityUsdt,
        snapshot.realizedPnlUsdt,
        snapshot.unrealizedPnlUsdt,
        snapshot.currentDrawdownPercent,
        snapshot.maxDrawdownPercent,
        JSON.stringify(snapshot),
      ],
    );
  }

  private async upsertPaperTrade(
    client: PoolClient,
    cycle: PersistedCycle,
    trade: PaperTradeOpened | PaperTradeClosed,
  ): Promise<void> {
    const eventKey =
      trade.type === "OPENED"
        ? `${cycle.symbol}:OPENED:${trade.timestamp}`
        : `${cycle.symbol}:CLOSED:${trade.entryTimestamp}:${trade.exitTimestamp}`;
    await client.query(
      `INSERT INTO paper_trades (
         event_key, symbol, event_type, candle_timestamp, replayed, trade
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (event_key) DO UPDATE SET
         replayed = EXCLUDED.replayed,
         trade = EXCLUDED.trade`,
      [
        eventKey,
        cycle.symbol,
        trade.type,
        cycle.candle.timestamp,
        cycle.replayed,
        JSON.stringify(trade),
      ],
    );
  }
}

