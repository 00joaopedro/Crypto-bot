import { createHash, randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { migrations } from "./migrations.js";
import type {
  PaperCycleResult,
  PaperTraderState,
  PaperTradeClosed,
  PaperTradeOpened,
} from "./paper-trader.js";
import type { DemoBuyResult } from "./okx-demo.js";
import type { AiDecision, Candle, QuantSignal } from "./types.js";

export type PersistedCycle = {
  symbol: string;
  candle: Candle;
  replayed: boolean;
  paperResult: PaperCycleResult;
  paperState: PaperTraderState;
  riskState?: { consecutiveLosses: number; stopLossCooldownUntil: number };
  decision?: {
    mode: "PAPER" | "PAPER_WITH_OKX_DEMO";
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
  settings: DashboardSettings;
  latestDecision: Record<string, unknown> | null;
  latestSnapshot: Record<string, unknown> | null;
  snapshots: Array<Record<string, unknown>>;
  trades: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  metrics: Record<string, unknown>;
  portfoliosBySymbol: Array<Record<string, unknown>>;
  health: Record<string, unknown>;
};

const MAX_SAFE_TRADES_PER_HOUR = 5;

export type OperationalEvent = {
  eventType: string;
  severity: "INFO" | "WARN" | "ERROR";
  symbol?: string;
  details?: Record<string, unknown>;
};

export interface BotPersistence {
  isPaused(): Promise<boolean>;
  loadRecoveryState?(symbol: string): Promise<RecoveryState | null>;
  setPaused(paused: boolean, actor: string): Promise<void>;
  recordCycle(cycle: PersistedCycle): Promise<void>;
  recordDemoOrder(
    symbol: string,
    candleTimestamp: number,
    result: DemoBuyResult,
  ): Promise<void>;
  recordDemoOrderFailure(
    symbol: string,
    candleTimestamp: number,
    error: string,
  ): Promise<void>;
  canPlaceDemoOrder(maxTrades: number, intervalMinutes: number): Promise<boolean>;
  canEnterSymbol?(symbol: string, cooldownMinutes: number): Promise<boolean>;
  recordOperationalEvent(event: OperationalEvent): Promise<void>;
  getDailyStartEquity?(symbol: string): Promise<number | undefined>;
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

  async setPaused(paused: boolean, actor: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE bot_control
         SET paused = $1, updated_at = NOW(), updated_by = $2
         WHERE id = 1`,
        [paused, actor],
      );
      await client.query(
        `INSERT INTO audit_events (event_type, actor, details)
         VALUES ('BOT_PAUSE_CHANGED', $1, $2::jsonb)`,
        [actor, JSON.stringify({ paused })],
      );
      await client.query(
        `INSERT INTO operational_events (event_type, severity, details)
         VALUES ('BOT_PAUSED', 'WARN', $1::jsonb)`,
        [JSON.stringify({ paused, actor })],
      );
      await client.query("COMMIT");
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
    // Existing dashboard rows predate the safety cap. Normalize them during
    // startup so a persisted value cannot bypass the configured hourly limit.
    await this.pool.query(
      `UPDATE dashboard_settings
       SET max_trades = LEAST(max_trades, $1), updated_at = NOW()
       WHERE id = 1 AND max_trades > $1`,
      [MAX_SAFE_TRADES_PER_HOUR],
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
      `SELECT symbol, order_size_usdt, paper_trade_size_usdt, max_trades, interval_minutes
       FROM dashboard_settings WHERE id = 1`,
    );
    const row = result.rows[0];
    if (!row) throw new Error("Dashboard settings are not initialized");
    return {
      symbol: row.symbol,
      orderSizeUsdt: Number(row.order_size_usdt),
      paperTradeSizeUsdt: row.paper_trade_size_usdt === null ? null : Number(row.paper_trade_size_usdt),
      maxTrades: Math.min(row.max_trades, MAX_SAFE_TRADES_PER_HOUR),
      intervalMinutes: row.interval_minutes,
      maxConcurrentPositions: Math.min(99, Math.max(1, Number(row.max_concurrent_positions))),
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
           updated_at = NOW(), updated_by = $6
         WHERE id = 1`,
        [settings.symbol, settings.orderSizeUsdt, Math.min(settings.maxTrades, MAX_SAFE_TRADES_PER_HOUR), settings.intervalMinutes, settings.maxConcurrentPositions, actor],
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
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM demo_orders
       WHERE status = 'PLACED'
         AND created_at >= NOW() - ($1 * INTERVAL '1 minute')`,
      [intervalMinutes],
    );
    return Number(result.rows[0]?.count ?? 0) < maxTrades;
  }

  async canEnterSymbol(symbol: string, cooldownMinutes: number): Promise<boolean> {
    const result = await this.pool.query<{ last_entry: Date | null }>(
      `SELECT MAX(created_at) AS last_entry FROM paper_trades
       WHERE symbol = $1 AND event_type = 'OPENED'
         AND created_at >= NOW() - ($2 * INTERVAL '1 minute')`,
      [symbol, cooldownMinutes],
    );
    return !result.rows[0]?.last_entry;
  }

  async recordOperationalEvent(event: OperationalEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO operational_events (event_type, severity, symbol, details)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [event.eventType, event.severity, event.symbol ?? null, JSON.stringify(event.details ?? {})],
    );
  }

  async getDailyStartEquity(symbol: string): Promise<number | undefined> {
    const result = await this.pool.query<{ equity_usdt: number }>(
      `SELECT equity_usdt FROM portfolio_snapshots
       WHERE symbol = $1 AND created_at >= date_trunc('day', NOW())
       ORDER BY created_at ASC LIMIT 1`,
      [symbol],
    );
    const equity = result.rows[0]?.equity_usdt;
    return equity === undefined ? undefined : Number(equity);
  }

  async getDashboardData(limit = 40, historySymbol?: string): Promise<DashboardData> {
    const settings = await this.getDashboardSettings();
    const [control, decision, snapshot, snapshots, trades, orders, decisionMetrics, tradeMetrics, eventMetrics, serviceEvents, portfolioRows] = await Promise.all([
      this.pool.query<{ paused: boolean }>("SELECT paused FROM bot_control WHERE id = 1"),
      this.pool.query<Record<string, unknown>>(
        `SELECT symbol, candle_timestamp, mode, signal, ai_decision, approved, created_at
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
        `SELECT client_order_id, symbol, status, result, created_at
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
      return aggregate;
    }, {});
    const closedTrades = Number(latestSnapshot?.closedTrades ?? tradeRow.exits ?? 0);
    const wins = Number(latestSnapshot?.wins ?? tradeRow.wins ?? 0);
    const latestCycleAt = snapshot.rows[0]?.created_at ?? null;
    const health = Object.fromEntries(serviceEvents.rows.map((row) => [row.service, row.status]));
    health.postgresql ??= "ok";
    return {
      paused: control.rows[0]?.paused ?? true,
      settings,
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
        netPnlUsdt: Number(tradeRow.net_pnl ?? latestSnapshot?.realizedPnlUsdt ?? 0),
        feesUsdt: Number(latestSnapshot?.totalFeesUsdt ?? 0),
        currentDrawdownPercent: Number(latestSnapshot?.currentDrawdownPercent ?? 0),
        maxDrawdownPercent: Number(latestSnapshot?.maxDrawdownPercent ?? 0),
        lastCycleAt: latestCycleAt,
        secondsSinceLastCycle: latestCycleAt ? Math.max(0, (Date.now() - new Date(String(latestCycleAt)).getTime()) / 1000) : null,
        buyAndHoldReturnPercent: Number(latestSnapshot?.buyAndHoldReturnPercent ?? 0),
        strategyReturnPercent: Number(latestSnapshot?.strategyReturnPercent ?? 0),
        excessReturnVsBuyAndHoldPercent: Number(latestSnapshot?.excessReturnVsBuyAndHoldPercent ?? 0),
        errorCount: Number(eventRow.errors ?? 0),
      },
      health: { ...health, lastOperationalEventAt: eventRow.last_event_at ?? null },
    };
  }

  async recordCycle(cycle: PersistedCycle): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
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
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO demo_orders (
         client_order_id, symbol, candle_timestamp, status, result
       ) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (client_order_id) DO UPDATE SET
         status = EXCLUDED.status,
         result = EXCLUDED.result,
         updated_at = NOW()`,
      [
        result.clientOrderId,
        symbol,
        candleTimestamp,
        result.status,
        JSON.stringify(result),
      ],
    );
  }

  async recordDemoOrderFailure(
    symbol: string,
    candleTimestamp: number,
    error: string,
  ): Promise<void> {
    const clientOrderId = `FAILED:${symbol}:${candleTimestamp}`;
    await this.pool.query(
      `INSERT INTO demo_orders (
         client_order_id, symbol, candle_timestamp, status, result
       ) VALUES ($1, $2, $3, 'FAILED', $4::jsonb)
       ON CONFLICT (client_order_id) DO UPDATE SET
         result = EXCLUDED.result,
         updated_at = NOW()`,
      [clientOrderId, symbol, candleTimestamp, JSON.stringify({ error })],
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
         symbol, candle_timestamp, mode, signal, ai_decision, approved
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
       ON CONFLICT (symbol, candle_timestamp) DO UPDATE SET
         mode = EXCLUDED.mode,
         signal = EXCLUDED.signal,
         ai_decision = EXCLUDED.ai_decision,
         approved = EXCLUDED.approved,
         updated_at = NOW()`,
      [
        cycle.symbol,
        cycle.candle.timestamp,
        decision.mode,
        JSON.stringify(decision.signal),
        JSON.stringify(decision.aiDecision),
        decision.approved,
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
