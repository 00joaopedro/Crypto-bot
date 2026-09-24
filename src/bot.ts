import type { PublicMarketData } from "./market-data.js";
import type { GeminiRiskFilter } from "./gemini.js";
import type { PaperCycleResult, PaperTrader } from "./paper-trader.js";
import type { OkxDemoExecutor } from "./okx-demo.js";
import type { BotPersistence } from "./persistence.js";
import { evaluateStrategy } from "./strategy.js";
import type { AiDecision, Candle } from "./types.js";
import type { EmailTradeAlert } from "./email-alerts.js";

type BotOptions = {
  symbol: string;
  candleLimit: number;
  minimumConfidence: number;
  paperTrader: PaperTrader;
  demoExecutor?: Pick<OkxDemoExecutor, "executeApprovedBuy">;
  ai?: GeminiRiskFilter;
  persistence?: BotPersistence;
  initialLastProcessedCandle?: number;
  maxTradesPerInterval?: number;
  tradeIntervalMinutes?: number;
  emailAlerts?: EmailTradeAlert;
};

export class TradingBot {
  private lastProcessedCandle: number | undefined;
  private demoExecutionBlocked = false;

  constructor(
    private readonly market: PublicMarketData,
    private readonly options: BotOptions,
  ) {
    this.lastProcessedCandle = options.initialLastProcessedCandle;
  }

  async runCycle(): Promise<void> {
    if (
      this.demoExecutionBlocked ||
      this.options.persistence &&
      (await this.options.persistence.isPaused())
    ) {
      console.log(
        JSON.stringify({ event: "cycle_skipped", reason: "bot_paused" }),
      );
      return;
    }

    const candles = await this.market.fetchClosedCandles(
      this.options.symbol,
      this.options.candleLimit,
    );
    await this.recordServiceStatus("market-data", "ok");
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
      const previousState = this.options.paperTrader.exportState();
      const paperResult = this.options.paperTrader.processCandle(candle, false);
      try {
        await this.options.persistence?.recordCycle({
          symbol: this.options.symbol,
          candle,
          replayed: true,
          paperResult,
          paperState: this.options.paperTrader.exportState(),
        });
      } catch (error) {
        this.options.paperTrader.restoreState(previousState);
        throw error;
      }
      this.logPaperResult(candle, paperResult, true);
      await this.sendTradeAlerts(paperResult.events, true);
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
        this.demoExecutionBlocked = true;
        console.error(
          JSON.stringify({
            event: "ai_filter_failed_closed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        await this.recordOperationalEvent("AI_ERROR", "ERROR", {
          error: error instanceof Error ? error.message : String(error),
        });
        await this.recordServiceStatus("gemini", "unhealthy", error);
      }
    }

    const approved =
      signal.action === "BUY" &&
      aiDecision.approve &&
      aiDecision.confidence >= this.options.minimumConfidence;

    const previousState = this.options.paperTrader.exportState();
    const paperResult = this.options.paperTrader.processCandle(
      currentCandle,
      approved,
    );
    try {
      await this.options.persistence?.recordCycle({
        symbol: this.options.symbol,
        candle: currentCandle,
        replayed: false,
        paperResult,
        paperState: this.options.paperTrader.exportState(),
        decision: {
          mode: this.options.demoExecutor ? "PAPER_WITH_OKX_DEMO" : "PAPER",
          signal,
          aiDecision,
          approved,
        },
      });
      await this.recordServiceStatus("postgresql", "ok");
    } catch (error) {
      this.options.paperTrader.restoreState(previousState);
      throw error;
    }
    this.lastProcessedCandle = currentCandle.timestamp;

    if (approved && this.options.demoExecutor) {
      try {
        const intervalLimitReached = Boolean(
          this.options.persistence &&
          this.options.maxTradesPerInterval &&
          this.options.tradeIntervalMinutes &&
          !(await this.options.persistence.canPlaceDemoOrder(
            this.options.maxTradesPerInterval,
            this.options.tradeIntervalMinutes,
          )),
        );
        if (intervalLimitReached) {
          console.log(
            JSON.stringify({
              event: "okx_demo_order_skipped",
              symbol: this.options.symbol,
              reason: "trade_interval_limit_reached",
              maxTrades: this.options.maxTradesPerInterval,
              intervalMinutes: this.options.tradeIntervalMinutes,
            }),
          );
          try {
            await this.options.persistence?.setPaused(
              true,
              "system:demo_order_persistence_failure",
            );
          } catch (pauseError) {
            console.error(
              JSON.stringify({
                event: "kill_switch_write_failed",
                error:
                  pauseError instanceof Error
                    ? pauseError.message
                    : String(pauseError),
              }),
            );
          }
        } else {
          const demoResult = await this.options.demoExecutor.executeApprovedBuy({
            candleTimestamp: currentCandle.timestamp,
          });
          try {
            await this.options.persistence?.recordDemoOrder(
              this.options.symbol,
              currentCandle.timestamp,
              demoResult,
            );
            await this.recordServiceStatus("postgresql", "ok");
          } catch (error) {
            console.error(
              JSON.stringify({
                event: "database_write_failed_after_order",
                symbol: this.options.symbol,
                candleTimestamp: currentCandle.timestamp,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
            await this.recordOperationalEvent("DATABASE_ERROR", "ERROR", {
              operation: "record_demo_order",
              error: error instanceof Error ? error.message : String(error),
            });
            await this.recordServiceStatus("postgresql", "unhealthy", error);
          }
          console.log(
            JSON.stringify({
              event:
                demoResult.status === "PLACED"
                  ? "okx_demo_order_submitted"
                  : "okx_demo_order_skipped",
              symbol: this.options.symbol,
              result: demoResult,
            }),
          );
          await this.recordServiceStatus("okx-demo", "ok");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          await this.options.persistence?.recordDemoOrderFailure(
            this.options.symbol,
            currentCandle.timestamp,
            message,
          );
        } catch (persistenceError) {
          console.error(
            JSON.stringify({
              event: "database_write_failed",
              operation: "record_demo_order_failure",
              error:
                persistenceError instanceof Error
                  ? persistenceError.message
                  : String(persistenceError),
            }),
          );
        }
        console.error(
          JSON.stringify({
            event: "okx_demo_order_failed",
            symbol: this.options.symbol,
            candleTimestamp: currentCandle.timestamp,
            error: message,
          }),
        );
        await this.recordOperationalEvent("OKX_ORDER_ERROR", "ERROR", {
          error: message,
        });
        await this.recordServiceStatus("okx-demo", "unhealthy", error);
      }
    }

    console.log(
      JSON.stringify({
        event: "decision",
        mode: this.options.demoExecutor ? "PAPER_WITH_OKX_DEMO" : "PAPER",
        symbol: this.options.symbol,
        signal,
        aiDecision,
        approved,
        execution: this.options.demoExecutor
          ? "paper_with_optional_okx_demo"
          : "simulated",
      }),
    );

    this.logPaperResult(currentCandle, paperResult, false);
    await this.sendTradeAlerts(paperResult.events, false);
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

  private async recordOperationalEvent(
    eventType: string,
    severity: "INFO" | "WARN" | "ERROR",
    details: Record<string, unknown>,
  ): Promise<void> {
    const record = this.options.persistence?.recordOperationalEvent;
    if (typeof record !== "function") return;
    try {
      await record.call(this.options.persistence, {
        eventType,
        severity,
        symbol: this.options.symbol,
        details,
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: "operational_event_persist_failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private async sendTradeAlerts(
    events: PaperCycleResult["events"],
    replayed: boolean,
  ): Promise<void> {
    if (!this.options.emailAlerts) return;
    for (const trade of events) {
      try {
        if (trade.type === "OPENED") {
          await this.options.emailAlerts.sendOpened(this.options.symbol, trade);
        } else {
          await this.options.emailAlerts.sendClosed(this.options.symbol, trade);
        }
        console.log(JSON.stringify({
          event: "trade_email_alert_sent",
          symbol: this.options.symbol,
          tradeType: trade.type,
          replayed,
        }));
      } catch (error) {
        console.error(JSON.stringify({
          event: "trade_email_alert_failed",
          symbol: this.options.symbol,
          tradeType: trade.type,
          replayed,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  }

  private async recordServiceStatus(
    service: string,
    status: "ok" | "unhealthy" | "disabled" | "configured",
    error?: unknown,
  ): Promise<void> {
    const record = this.options.persistence?.recordOperationalEvent;
    if (typeof record !== "function") return;
    try {
      await record.call(this.options.persistence, {
        eventType: "SERVICE_STATUS",
        severity: status === "unhealthy" ? "ERROR" : "INFO",
        symbol: this.options.symbol,
        details: {
          service,
          status,
          ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
        },
      });
    } catch (persistError) {
      console.error(JSON.stringify({
        event: "operational_event_persist_failed",
        error: persistError instanceof Error ? persistError.message : String(persistError),
      }));
    }
  }
}
