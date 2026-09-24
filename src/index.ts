import type { Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import { TradingBot } from "./bot.js";
import { config } from "./config.js";
import { startDashboard, stopDashboard } from "./dashboard.js";
import { GeminiRiskFilter } from "./gemini.js";
import { PublicMarketData } from "./market-data.js";
import { OkxDemoExecutor } from "./okx-demo.js";
import { PaperTrader } from "./paper-trader.js";
import { PostgresPersistence } from "./persistence.js";
import type { DashboardSettings } from "./persistence.js";

async function sleep(
  milliseconds: number,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    await delay(milliseconds, undefined, { signal });
    return true;
  } catch (error) {
    if (signal.aborted && error instanceof Error && error.name === "AbortError") {
      return false;
    }

    throw error;
  }
}

async function main(): Promise<void> {
  let stopping = false;
  const shutdownController = new AbortController();
  const stop = () => {
    stopping = true;
    shutdownController.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const market = new PublicMarketData(config.MARKET_DATA_PROVIDER);
  const persistence = config.DATABASE_URL
    ? new PostgresPersistence(
        config.DATABASE_URL,
        config.DATABASE_CONNECTION_TIMEOUT_MS,
      )
    : undefined;
  let runId: string | undefined;
  let dashboardServer: Server | undefined;
  let okxDemo: OkxDemoExecutor | undefined;
  let tradingSettings: DashboardSettings = {
    symbol: config.SYMBOL,
    orderSizeUsdt: config.OKX_DEMO_ORDER_SIZE_USDT,
    paperTradeSizeUsdt: null,
    maxTrades: 1,
    intervalMinutes: 60,
  };

  try {
    let recoveryState = null;
    if (persistence) {
      await initializeDatabaseWithBackoff(
        persistence,
        shutdownController.signal,
      );
      if (stopping) return;
      tradingSettings =
        await persistence.ensureDashboardSettings(tradingSettings);
      recoveryState = await persistence.loadRecoveryState(tradingSettings.symbol);
      runId = await persistence.startRun({
        environment: config.ENVIRONMENT,
        executionProvider: config.EXECUTION_PROVIDER,
        symbol: tradingSettings.symbol,
        timeframe: config.TIMEFRAME,
      });
      console.log(
        JSON.stringify({
          event: "database_connected",
          migrationsApplied: true,
          recovery: recoveryState
            ? {
                restored: true,
                lastProcessedCandle: recoveryState.lastProcessedCandle,
              }
            : { restored: false },
        }),
      );
    } else {
      console.log(JSON.stringify({ event: "persistence_disabled" }));
    }

    await initializeWithBackoff(market, shutdownController.signal);
    if (stopping) return;

    okxDemo =
      config.EXECUTION_PROVIDER === "okx-demo"
        ? new OkxDemoExecutor(
            {
              apiKey: config.OKX_API_KEY!,
              secretKey: config.OKX_SECRET_KEY!,
              passphrase: config.OKX_PASSPHRASE!,
            },
            {
              symbol: tradingSettings.symbol,
              tradingEnabled: config.OKX_DEMO_TRADING_ENABLED,
              orderSizeUsdt: tradingSettings.orderSizeUsdt,
              stopLossRate: config.OKX_DEMO_STOP_LOSS_RATE,
              takeProfitRate: config.OKX_DEMO_TAKE_PROFIT_RATE,
            },
          )
        : undefined;

    if (okxDemo) {
      await initializeOkxDemoWithBackoff(
        okxDemo,
        tradingSettings,
        shutdownController.signal,
      );
      if (stopping) return;
    }

    if (
      persistence &&
      config.DASHBOARD_PASSWORD &&
      config.DASHBOARD_SESSION_SECRET
    ) {
      const marketSymbols = new Set(market.listSpotSymbols());
      const executionSymbols = okxDemo?.listSpotSymbols() ?? [...marketSymbols];
      const supportedSymbols = executionSymbols.filter((symbol) =>
        marketSymbols.has(symbol),
      );
      dashboardServer = await startDashboard({
        port: config.PORT,
        password: config.DASHBOARD_PASSWORD,
        sessionSecret: config.DASHBOARD_SESSION_SECRET,
        persistence,
        supportedSymbols,
        onSettingsChanged: () => {
          process.exitCode = 75;
          stop();
        },
      });
    } else {
      console.log(JSON.stringify({ event: "dashboard_disabled" }));
    }

    const ai = config.GEMINI_ENABLED
      ? new GeminiRiskFilter(config.GEMINI_API_KEY!, config.GEMINI_MODEL)
      : undefined;
    const paperTrader = new PaperTrader(
      {
        initialBalanceUsdt: config.PAPER_INITIAL_BALANCE_USDT,
        tradeSizeUsdt:
          tradingSettings.paperTradeSizeUsdt ?? config.PAPER_TRADE_SIZE_USDT,
        feeRate: config.PAPER_FEE_RATE,
        slippageRate: config.PAPER_SLIPPAGE_RATE,
        stopLossRate: config.PAPER_STOP_LOSS_RATE,
        takeProfitRate: config.PAPER_TAKE_PROFIT_RATE,
      },
      recoveryState?.paperState,
    );

    const bot = new TradingBot(market, {
      symbol: tradingSettings.symbol,
      candleLimit: config.CANDLE_LIMIT,
      minimumConfidence: config.MIN_AI_CONFIDENCE,
      paperTrader,
      ...(okxDemo ? { demoExecutor: okxDemo } : {}),
      ...(ai ? { ai } : {}),
      ...(persistence ? { persistence } : {}),
      ...(recoveryState
        ? { initialLastProcessedCandle: recoveryState.lastProcessedCandle }
        : {}),
      maxTradesPerInterval: tradingSettings.maxTrades,
      tradeIntervalMinutes: tradingSettings.intervalMinutes,
    });

    console.log(
      JSON.stringify({
        event: "bot_started",
        environment: config.ENVIRONMENT,
        executionMode: config.OKX_DEMO_TRADING_ENABLED
          ? "PAPER_AND_OKX_DEMO"
          : "PAPER",
        executionProvider: config.EXECUTION_PROVIDER,
        liveTradingEnabled: config.LIVE_TRADING_ENABLED,
        okxDemoTradingEnabled: config.OKX_DEMO_TRADING_ENABLED,
        marketDataProvider: config.MARKET_DATA_PROVIDER,
        symbol: tradingSettings.symbol,
        timeframe: config.TIMEFRAME,
        aiEnabled: config.GEMINI_ENABLED,
        persistenceEnabled: Boolean(persistence),
        paperTrading: {
          initialBalanceUsdt: config.PAPER_INITIAL_BALANCE_USDT,
          tradeSizeUsdt:
            tradingSettings.paperTradeSizeUsdt ?? config.PAPER_TRADE_SIZE_USDT,
          feeRate: config.PAPER_FEE_RATE,
          slippageRate: config.PAPER_SLIPPAGE_RATE,
          stopLossRate: config.PAPER_STOP_LOSS_RATE,
          takeProfitRate: config.PAPER_TAKE_PROFIT_RATE,
        },
      }),
    );

    while (!stopping) {
      try {
        await bot.runCycle();
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "cycle_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }

      if (!stopping) {
        await sleep(config.LOOP_DELAY_MS, shutdownController.signal);
      }
    }
  } finally {
    if (persistence && runId) {
      try {
        await persistence.stopRun(
          runId,
          stopping ? "signal_shutdown" : "unexpected_shutdown",
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "database_write_failed",
            operation: "stop_run",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    await Promise.allSettled([
      stopDashboard(dashboardServer),
      market.close(),
      okxDemo?.close(),
      persistence?.close(),
    ]);
  }
}

async function initializeDatabaseWithBackoff(
  persistence: PostgresPersistence,
  signal: AbortSignal,
): Promise<void> {
  let delayMs = 5_000;

  while (!signal.aborted) {
    try {
      await persistence.initialize();
      return;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "database_initialization_failed",
          retryInMs: delayMs,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      if (!(await sleep(delayMs, signal))) return;
      delayMs = Math.min(delayMs * 2, 60_000);
    }
  }
}

async function initializeOkxDemoWithBackoff(
  okxDemo: OkxDemoExecutor,
  tradingSettings: DashboardSettings,
  signal: AbortSignal,
): Promise<void> {
  let delayMs = 15_000;

  while (!signal.aborted) {
    try {
      const status = await okxDemo.initialize();
      console.log(JSON.stringify({ event: "okx_demo_connected", ...status }));
      console.log(
        JSON.stringify(
          status.orderExecutionEnabled
            ? {
                event: "okx_demo_execution_armed",
                provider: "okx-demo",
                orderSizeUsdt: tradingSettings.orderSizeUsdt,
                maxTrades: tradingSettings.maxTrades,
                intervalMinutes: tradingSettings.intervalMinutes,
                stopLossRate: config.OKX_DEMO_STOP_LOSS_RATE,
                takeProfitRate: config.OKX_DEMO_TAKE_PROFIT_RATE,
              }
            : {
                event: "execution_disabled",
                provider: "okx-demo",
                reason: "OKX_DEMO_TRADING_ENABLED=false",
              },
        ),
      );
      return;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "okx_demo_initialization_failed",
          provider: "okx-demo",
          retryInMs: delayMs,
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      if (!(await sleep(delayMs, signal))) return;
      delayMs = Math.min(delayMs * 2, 5 * 60_000);
    }
  }
}

async function initializeWithBackoff(
  market: PublicMarketData,
  signal: AbortSignal,
): Promise<void> {
  let delayMs = 15_000;

  while (!signal.aborted) {
    try {
      await market.initialize();
      return;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "market_initialization_failed",
          provider: market.provider,
          retryInMs: delayMs,
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      if (!(await sleep(delayMs, signal))) {
        return;
      }

      delayMs = Math.min(delayMs * 2, 5 * 60_000);
    }
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "fatal_error",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
