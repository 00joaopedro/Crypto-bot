import { TradingBot } from "./bot.js";
import { config } from "./config.js";
import { GeminiRiskFilter } from "./gemini.js";
import { PublicMarketData } from "./market-data.js";

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function main(): Promise<void> {
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const market = new PublicMarketData(config.MARKET_DATA_PROVIDER);

  try {
    await initializeWithBackoff(market, () => stopping);
    if (stopping) return;

    const ai = config.GEMINI_ENABLED
      ? new GeminiRiskFilter(config.GEMINI_API_KEY!, config.GEMINI_MODEL)
      : undefined;

    const bot = new TradingBot(market, {
      symbol: config.SYMBOL,
      candleLimit: config.CANDLE_LIMIT,
      minimumConfidence: config.MIN_AI_CONFIDENCE,
      ...(ai ? { ai } : {}),
    });

    console.log(JSON.stringify({
      event: "bot_started",
      environment: config.ENVIRONMENT,
      marketDataProvider: config.MARKET_DATA_PROVIDER,
      symbol: config.SYMBOL,
      timeframe: config.TIMEFRAME,
      aiEnabled: config.GEMINI_ENABLED,
    }));

    while (!stopping) {
      try {
        await bot.runCycle();
      } catch (error) {
        console.error(JSON.stringify({
          event: "cycle_failed",
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      if (!stopping) await sleep(config.LOOP_DELAY_MS);
    }
  } finally {
    await market.close();
  }
}

async function initializeWithBackoff(
  market: PublicMarketData,
  isStopping: () => boolean,
): Promise<void> {
  let delayMs = 15_000;

  while (!isStopping()) {
    try {
      await market.initialize();
      return;
    } catch (error) {
      console.error(JSON.stringify({
        event: "market_initialization_failed",
        provider: market.provider,
        retryInMs: delayMs,
        error: error instanceof Error ? error.message : String(error),
      }));
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 5 * 60_000);
    }
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "fatal_error",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
