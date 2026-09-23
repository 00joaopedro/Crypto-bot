import type { PublicMarketData } from "./market-data.js";
import type { GeminiRiskFilter } from "./gemini.js";
import type { PaperCycleResult, PaperTrader } from "./paper-trader.js";
import { evaluateStrategy } from "./strategy.js";
import type { AiDecision, Candle } from "./types.js";

type BotOptions = {
  symbol: string;
  candleLimit: number;
  minimumConfidence: number;
  paperTrader: PaperTrader;
  ai?: GeminiRiskFilter;
};

export class TradingBot {
  private lastProcessedCandle: number | undefined;

  constructor(
    private readonly market: PublicMarketData,
    private readonly options: BotOptions,
  ) {}

  async runCycle(): Promise<void> {
    const candles = await this.market.fetchClosedCandles(
      this.options.symbol,
      this.options.candleLimit,
    );
    const latest = candles.at(-1);
    if (!latest) throw new Error("Market data provider returned no closed candles");

    const unseenCandles =
      this.lastProcessedCandle === undefined
        ? [latest]
        : candles.filter(
            (candle) => candle.timestamp > this.lastProcessedCandle!,
          );

    if (unseenCandles.length === 0) {
      console.log(
        JSON.stringify({
          event: "cycle_skipped",
          reason: "candle_already_processed",
        }),
      );
      return;
    }

    // Replayed candles can close an existing position, but cannot create a
    // retrospective entry. Approval is calculated only for the newest candle.
    for (const candle of unseenCandles.slice(0, -1)) {
      const paperResult = this.options.paperTrader.processCandle(candle, false);
      this.logPaperResult(candle, paperResult, true);
      this.lastProcessedCandle = candle.timestamp;
    }

    const currentCandle = unseenCandles.at(-1)!;
    const currentIndex = candles.findIndex(
      (candle) => candle.timestamp === currentCandle.timestamp,
    );
    const signal = evaluateStrategy(candles.slice(0, currentIndex + 1));

    let aiDecision: AiDecision = {
      approve: false,
      confidence: 0,
      reason:
        signal.action === "BUY"
          ? "AI filter is disabled"
          : "AI filter is not called for HOLD signals",
    };

    if (signal.action === "BUY" && this.options.ai) {
      try {
        aiDecision = await this.options.ai.evaluate(signal);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "ai_filter_failed_closed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    const approved =
      signal.action === "BUY" &&
      aiDecision.approve &&
      aiDecision.confidence >= this.options.minimumConfidence;

    const paperResult = this.options.paperTrader.processCandle(
      currentCandle,
      approved,
    );
    this.lastProcessedCandle = currentCandle.timestamp;

    console.log(
      JSON.stringify({
        event: "decision",
        mode: "PAPER",
        symbol: this.options.symbol,
        signal,
        aiDecision,
        approved,
        execution: "simulated",
      }),
    );

    this.logPaperResult(currentCandle, paperResult, false);
  }

  private logPaperResult(
    candle: Candle,
    result: PaperCycleResult,
    replayed: boolean,
  ): void {
    for (const event of result.events) {
      console.log(
        JSON.stringify({
          event:
            event.type === "OPENED"
              ? "paper_trade_opened"
              : "paper_trade_closed",
          symbol: this.options.symbol,
          replayed,
          trade: event,
        }),
      );
    }

    console.log(
      JSON.stringify({
        event: "paper_portfolio_snapshot",
        symbol: this.options.symbol,
        candleTimestamp: candle.timestamp,
        replayed,
        portfolio: result.snapshot,
      }),
    );
  }
}
