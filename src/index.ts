import { setTimeout as delay } from "node:timers/promises";

import { TradingBot } from "./bot.js";
import { config } from "./config.js";
import { GeminiRiskFilter } from "./gemini.js";
import { PublicMarketData } from "./market-data.js";
import { PaperTrader } from "./paper-trader.js";

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

  try {
    await initializeWithBackoff(market, shutdownController.signal);
    if (stopping) return;

    const ai = config.GEMINI_ENABLED
      ? new GeminiRiskFilter(config.GEMINI_API_KEY!, config.GEMINI_MODEL)
      : undefined;
    const paperTrader = new PaperTrader({
      initialBalanceUsdt: config.PAPER_INITIAL_BALANCE_USDT,
      tradeSizeUsdt: config.PAPER_TRADE_SIZE_USDT,
      feeRate: config.PAPER_FEE_RATE,
      slippageRate: config.PAPER_SLIPPAGE_RATE,
      stopLossRate: config.PAPER_STOP_LOSS_RATE,
      takeProfitRate: config.PAPER_TAKE_PROFIT_RATE,
    });

    const bot = new TradingBot(market, {
      symbol: config.SYMBOL,
      candleLimit: config.CANDLE_LIMIT,
      minimumConfidence: config.MIN_AI_CONFIDENCE,
      paperTrader,
      ...(ai ? { ai } : {}),
    });

    console.log(
      JSON.stringify({
        event: "bot_started",
        environment: config.ENVIRONMENT,
        executionMode: "PAPER",
        marketDataProvider: config.MARKET_DATA_PROVIDER,
        symbol: config.SYMBOL,
        timeframe: config.TIMEFRAME,
        aiEnabled: config.GEMINI_ENABLED,
        paperTrading: {
          initialBalanceUsdt: config.PAPER_INITIAL_BALANCE_USDT,
          tradeSizeUsdt: config.PAPER_TRADE_SIZE_USDT,
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
    await market.close();
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
