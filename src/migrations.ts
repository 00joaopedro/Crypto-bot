export type Migration = {
  version: number;
  name: string;
  sql: string;
};

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "database_foundation",
    sql: `
      CREATE TABLE bot_runs (
        id UUID PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        stopped_at TIMESTAMPTZ,
        stop_reason TEXT,
        metadata JSONB NOT NULL
      );

      CREATE TABLE decisions (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        candle_timestamp BIGINT NOT NULL,
        mode TEXT NOT NULL,
        signal JSONB NOT NULL,
        ai_decision JSONB NOT NULL,
        approved BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (symbol, candle_timestamp)
      );

      CREATE TABLE portfolio_snapshots (
        id BIGSERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        candle_timestamp BIGINT NOT NULL,
        replayed BOOLEAN NOT NULL,
        equity_usdt DOUBLE PRECISION NOT NULL,
        realized_pnl_usdt DOUBLE PRECISION NOT NULL,
        unrealized_pnl_usdt DOUBLE PRECISION NOT NULL,
        current_drawdown_percent DOUBLE PRECISION NOT NULL,
        max_drawdown_percent DOUBLE PRECISION NOT NULL,
        snapshot JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (symbol, candle_timestamp)
      );

      CREATE TABLE paper_trades (
        event_key TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN ('OPENED', 'CLOSED')),
        candle_timestamp BIGINT NOT NULL,
        replayed BOOLEAN NOT NULL,
        trade JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE paper_trader_state (
        symbol TEXT PRIMARY KEY,
        last_processed_candle BIGINT NOT NULL,
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE demo_orders (
        client_order_id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        candle_timestamp BIGINT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PLACED', 'SKIPPED', 'FAILED')),
        result JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE bot_control (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        paused BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by TEXT NOT NULL DEFAULT 'system'
      );

      INSERT INTO bot_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

      CREATE TABLE audit_events (
        id BIGSERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX decisions_created_at_idx ON decisions (created_at DESC);
      CREATE INDEX portfolio_snapshots_timestamp_idx
        ON portfolio_snapshots (symbol, candle_timestamp DESC);
      CREATE INDEX paper_trades_timestamp_idx
        ON paper_trades (symbol, candle_timestamp DESC);
      CREATE INDEX demo_orders_timestamp_idx
        ON demo_orders (symbol, candle_timestamp DESC);
      CREATE INDEX audit_events_created_at_idx ON audit_events (created_at DESC);
    `,
  },
] as const;
