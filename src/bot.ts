import type { PublicMarketData } from "./market-data.js";
import type { GeminiRiskFilter } from "./gemini.js";
import type { PaperCycleResult, PaperTrader } from "./paper-trader.js";
import type { OkxDemoExecutor } from "./okx-demo.js";
import type { BotPersistence } from "./persistence.js";
import { evaluateStrategy } from "./strategy.js";
import { rankSignals, type RankedSignal } from "./signal-ranking.js";
import type { AiDecision, Candle } from "./types.js";
import type { EmailTradeAlert } from "./email-alerts.js";

type BotOptions = {
  symbol: string;
  candleLimit: number;
  minimumConfidence: number;
  minimumSignalScore?: number;
  signalScanSymbols?: string[];
  paperTrader: PaperTrader;
  demoExecutor?: Pick<OkxDemoExecutor, "executeApprovedBuy">;
  ai?: GeminiRiskFilter;
  persistence?: BotPersistence;
  initialLastProcessedCandle?: number;
  maxTradesPerInterval?: number;
  tradeIntervalMinutes?: number;
  maxExposurePercent?: number;
  riskPerTradePercent?: number;
  maxDailyLossPercent?: number;
  maxDrawdownPercent?: number;
  emailAlerts?: EmailTradeAlert;
};

export class TradingBot {
  private lastProcessedCandle: number | undefined;
  private demoExecutionBlocked = false;
  private dailyDate = new Date().toISOString().slice(0, 10);
  private dailyStartEquity: number | undefined;

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

    const ranking = await this.scanSignals(candles);
    if (ranking.length > 0) {
      console.log(JSON.stringify({
        event: "signal_ranking",
        candleTimestamp: latest.timestamp,
        selected: ranking[0],
        candidates: ranking.map((candidate) => ({
          rank: candidate.rank,
          symbol: candidate.symbol,
          action: candidate.signal.action,
          score: candidate.signal.score,
          eligible: candidate.eligible,
        })),
      }));
    }
    const selectedEligibleSymbol = ranking.find((candidate) => candidate.eligible)?.symbol;
    const currentSymbolSelected =
      selectedEligibleSymbol === undefined || selectedEligibleSymbol === this.options.symbol;

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
    const signalCandles = candles.slice(0, currentIndex + 1);
    const signal = this.options.minimumSignalScore === undefined
      ? evaluateStrategy(signalCandles)
      : evaluateStrategy(signalCandles, {
          minimumScore: this.options.minimumSignalScore,
        });

    let aiDecision: AiDecision = {
      approve: false,
      confidence: 0,
      reason:
        signal.action === "BUY"
          ? "AI filter is disabled"
          : "AI filter is not called for HOLD signals",
    };

    if (signal.action === "BUY" && currentSymbolSelected && this.options.ai) {
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

    let approved =
      signal.action === "BUY" &&
      aiDecision.approve &&
      aiDecision.confidence >= this.options.minimumConfidence &&
      currentSymbolSelected;

    const riskBlock = approved ? this.riskBlockReason() : undefined;
    if (riskBlock) {
      approved = false;
      console.log(JSON.stringify({
        event: "trade_blocked_by_risk",
        symbol: this.options.symbol,
        reason: riskBlock,
      }));
      await this.recordOperationalEvent("RISK_LIMIT", "WARN", { reason: riskBlock });
    }

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

    this.updateDailyRiskBaseline(paperResult.snapshot.equityUsdt);
    const dailyLossPercent = this.dailyStartEquity
      ? Math.max(0, (this.dailyStartEquity - paperResult.snapshot.equityUsdt) / this.dailyStartEquity)
      : 0;
    if (
      this.options.persistence &&
      ((this.options.maxDrawdownPercent !== undefined &&
        paperResult.snapshot.currentDrawdownPercent >= this.options.maxDrawdownPercent) ||
        (this.options.maxDailyLossPercent !== undefined && dailyLossPercent >= this.options.maxDailyLossPercent))
    ) {
      await this.options.persistence.setPaused(true, "system:risk_limit");
      console.log(JSON.stringify({
        event: "risk_pause_triggered",
        symbol: this.options.symbol,
        currentDrawdownPercent: paperResult.snapshot.currentDrawdownPercent,
        dailyLossPercent,
      }));
    }

    const paperOpened = paperResult.events.some((event) => event.type === "OPENED");
    if (approved && this.options.demoExecutor && paperOpened) {
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

    if (approved && this.options.demoExecutor && !paperOpened) {
      console.log(
        JSON.stringify({
          event: "okx_demo_order_skipped",
          symbol: this.options.symbol,
          reason: "paper_position_not_opened",
          paperEvents: paperResult.events.map((event) => event.type),
        }),
      );
    }

    console.log(
      JSON.stringify({
        event: "decision",
        mode: this.options.demoExecutor ? "PAPER_WITH_OKX_DEMO" : "PAPER",
        symbol: this.options.symbol,
        signal,
        aiDecision,
        approved,
        selectedSignalSymbol: selectedEligibleSymbol ?? null,
        execution: this.options.demoExecutor
          ? "paper_with_optional_okx_demo"
          : "simulated",
      }),
    );

    this.logPaperResult(currentCandle, paperResult, false);
    await this.sendTradeAlerts(paperResult.events, false);
  }

  private async scanSignals(currentCandles: Candle[]): Promise<RankedSignal[]> {
    const symbols = [...new Set(this.options.signalScanSymbols ?? [this.options.symbol])];
    const candidates: Array<{ symbol: string; candles: Candle[] }> = [
      { symbol: this.options.symbol, candles: currentCandles },
    ];

    for (const symbol of symbols) {
      if (symbol === this.options.symbol) continue;
      try {
        const targetTimestamp = currentCandles.at(-1)?.timestamp;
        const candles = await this.market.fetchClosedCandles(
          symbol,
          this.options.candleLimit + 5,
        );
        const targetIndex = targetTimestamp === undefined
          ? -1
          : candles.findIndex((candle) => candle.timestamp === targetTimestamp);
        if (targetIndex >= 0) {
          const alignedCandles = candles.slice(0, targetIndex + 1);
          if (alignedCandles.length >= 50) {
            candidates.push({ symbol, candles: alignedCandles });
          }
        }
      } catch (error) {
        console.error(JSON.stringify({
          event: "signal_scan_failed",
          symbol,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    return rankSignals(candidates, this.options.minimumSignalScore);
  }

  private updateDailyRiskBaseline(equity: number): void {
    const date = new Date().toISOString().slice(0, 10);
    if (date !== this.dailyDate) {
      this.dailyDate = date;
      this.dailyStartEquity = equity;
    } else {
      this.dailyStartEquity ??= equity;
    }
  }

  private riskBlockReason(): string | undefined {
    const traderState = this.options.paperTrader.exportState();
    if (traderState.position) return "position_already_open";
    const balance = Math.max(traderState.peakEquityUsdt, traderState.cashUsdt);
    const tradeSize = this.options.paperTrader.tradeSizeUsdt;
    if (this.options.maxExposurePercent !== undefined && tradeSize / balance > this.options.maxExposurePercent) {
      return "max_exposure_percent";
    }
    if (this.options.riskPerTradePercent !== undefined) {
      const estimatedRisk = tradeSize * ((this.options.paperTrader.stopLossRate ?? 0) + 0.002);
      if (estimatedRisk / balance > this.options.riskPerTradePercent) return "risk_per_trade_percent";
    }
    return undefined;
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
