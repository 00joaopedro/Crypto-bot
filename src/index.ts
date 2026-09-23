import { TradingBot } from "./bot.js";
import { BybitMarketData } from "./bybit.js";
import { config } from "./config.js";
import { GeminiRiskFilter } from "./gemini.js";

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function main(): Promise<void> {
  const market = new BybitMarketData();
  await market.initialize();

  const ai = config.GEMINI_ENABLED
    ? new GeminiRiskFilter(config.GEMINI_API_KEY!, config.GEMINI_MODEL)
    : undefined;

  const bot = new TradingBot(market, {
    symbol: config.SYMBOL,
    candleLimit: config.CANDLE_LIMIT,
    minimumConfidence: config.MIN_AI_CONFIDENCE,
    ...(ai ? { ai } : {}),
  });

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  console.log(JSON.stringify({
    event: "bot_started",
    environment: config.ENVIRONMENT,
    symbol: config.SYMBOL,
    timeframe: config.TIMEFRAME,
    aiEnabled: config.GEMINI_ENABLED,
  }));

  try {
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

main().catch((error) => {
  console.error(JSON.stringify({
    event: "fatal_error",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
