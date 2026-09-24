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
  decision?: {
    mode: "PAPER" | "PAPER_WITH_OKX_DEMO";
    signal: QuantSignal;
    aiDecision: AiDecision;
    approved: boolean;
  };
};

export type RecoveryState = {
  lastProcessedCandle: number;
  paperState: PaperTraderState;
};

export type DashboardSettings = {
  symbol: string;
  orderSizeUsdt: number;
  maxTrades: number;
  intervalMinutes: number;
};

export type DashboardData = {
  paused: boolean;
  settings: DashboardSettings;
  latestDecision: Record<string, unknown> | null;
  latestSnapshot: Record<string, unknown> | null;
  snapshots: Array<Record<string, unknown>>;
  trades: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
};

export interface BotPersistence {
  isPaused(): Promise<boolean>;
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

    return {
      lastProcessedCandle,
      paperState: row.state as PaperTraderState,
    };
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
         id, symbol, order_size_usdt, max_trades, interval_minutes
       ) VALUES (1, $1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [defaults.symbol, defaults.orderSizeUsdt, defaults.maxTrades, defaults.intervalMinutes],
    );
    return this.getDashboardSettings();
  }

  async getDashboardSettings(): Promise<DashboardSettings> {
    const result = await this.pool.query<{
      symbol: string;
      order_size_usdt: number;
      max_trades: number;
      interval_minutes: number;
    }>(
      `SELECT symbol, order_size_usdt, max_trades, interval_minutes
       FROM dashboard_settings WHERE id = 1`,
    );
    const row = result.rows[0];
    if (!row) throw new Error("Dashboard settings are not initialized");
    return {
      symbol: row.symbol,
      orderSizeUsdt: Number(row.order_size_usdt),
      maxTrades: row.max_trades,
      intervalMinutes: row.interval_minutes,
    };
  }

  async updateDashboardSettings(settings: DashboardSettings, actor: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE dashboard_settings SET
           symbol = $1, order_size_usdt = $2, max_trades = $3,
           interval_minutes = $4, updated_at = NOW(), updated_by = $5
         WHERE id = 1`,
        [settings.symbol, settings.orderSizeUsdt, settings.maxTrades, settings.intervalMinutes, actor],
      );
      await client.query(
        `INSERT INTO audit_events (event_type, actor, details)
         VALUES ('TRADING_SETTINGS_CHANGED', $1, $2::jsonb)`,
        [actor, JSON.stringify(settings)],
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

  async getDashboardData(limit = 40): Promise<DashboardData> {
    const settings = await this.getDashboardSettings();
    const [control, decision, snapshot, snapshots, trades, orders] = await Promise.all([
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
         FROM paper_trades WHERE symbol = $1 ORDER BY created_at DESC LIMIT $2`,
        [settings.symbol, limit],
      ),
      this.pool.query<Record<string, unknown>>(
        `SELECT client_order_id, symbol, status, result, created_at
         FROM demo_orders WHERE symbol = $1 ORDER BY created_at DESC LIMIT $2`,
        [settings.symbol, limit],
      ),
    ]);
    return {
      paused: control.rows[0]?.paused ?? true,
      settings,
      latestDecision: decision.rows[0] ?? null,
      latestSnapshot: snapshot.rows[0] ?? null,
      snapshots: snapshots.rows.reverse(),
      trades: trades.rows,
      orders: orders.rows,
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
          JSON.stringify(cycle.paperState),
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
