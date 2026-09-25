import type { PublicMarketData } from "./market-data.js";
import type { GeminiRiskFilter } from "./gemini.js";
import { PaperTrader, type PaperCycleResult } from "./paper-trader.js";
import type { OkxDemoExecutor } from "./okx-demo.js";
import type { BotPersistence } from "./persistence.js";
import { evaluateStrategy } from "./strategy.js";
import { rankSignals, type RankedSignal } from "./signal-ranking.js";
import { averageTrueRange } from "./indicators.js";
import type { AiDecision, Candle } from "./types.js";
import type { EmailTradeAlert } from "./email-alerts.js";
import type { CentralTradeManager } from "./trade-manager.js";

type BotOptions = {
  symbol: string;
  candleLimit: number;
  minimumConfidence: number;
  minimumSignalScore?: number;
  signalScanSymbols?: string[];
  dynamicUniverseSize?: number;
  marketMinQuoteVolumeUsdt?: number;
  marketMaxSpreadPercent?: number;
  universeSwitchCooldownMinutes?: number;
  universeSwitchMinScoreAdvantage?: number;
  universeMaxReplacements?: number;
  paperTrader: PaperTrader;
  demoExecutor?: Pick<OkxDemoExecutor, "executeApprovedBuy">;
  ai?: GeminiRiskFilter;
  persistence?: BotPersistence;
  initialLastProcessedCandle?: number;
  initialRiskState?: { consecutiveLosses: number; stopLossCooldownUntil: number };
  maxTradesPerInterval?: number;
  tradeIntervalMinutes?: number;
  demoOrderSizeUsdt?: number;
  atrPeriod?: number;
  atrStopMultiplier?: number;
  atrTakeProfitMultiplier?: number;
  atrMinStopRate?: number;
  atrMaxStopRate?: number;
  fallbackStopLossRate?: number;
  fallbackTakeProfitRate?: number;
  entryCooldownMinutes?: number;
  maxExposurePercent?: number;
  riskPerTradePercent?: number;
  maxDailyLossPercent?: number;
  maxDrawdownPercent?: number;
  maxConsecutiveLosses?: number;
  stopLossCooldownMinutes?: number;
  tradeManager?: CentralTradeManager;
  emailAlerts?: EmailTradeAlert;
};

export class TradingBot {
  private lastProcessedCandle: number | undefined;
  private demoExecutionBlocked = false;
  private dailyDate = new Date().toISOString().slice(0, 10);
  private dailyStartEquity: number | undefined;
  private readonly dailyStartEquityBySymbol = new Map<string, number>();
  private readonly lastEntryAtBySymbol = new Map<string, number>();
  private consecutiveLosses: number;
  private stopLossCooldownUntil: number;
  private observedPaused = false;
  private activeUniverse: string[] = [];
  private lastUniverseSwitchAt = 0;
  private readonly paperTraders = new Map<string, PaperTrader>();
  private readonly loadedPaperSymbols = new Set<string>();
  private readonly lastProcessedCandleBySymbol = new Map<string, number>();

  constructor(
    private readonly market: PublicMarketData,
    private readonly options: BotOptions,
  ) {
    this.lastProcessedCandle = options.initialLastProcessedCandle;
    this.consecutiveLosses = options.initialRiskState?.consecutiveLosses ?? 0;
    this.stopLossCooldownUntil = options.initialRiskState?.stopLossCooldownUntil ?? 0;
    this.paperTraders.set(options.symbol, options.paperTrader);
    this.loadedPaperSymbols.add(options.symbol);
    if (options.initialLastProcessedCandle !== undefined) {
      this.lastProcessedCandleBySymbol.set(options.symbol, options.initialLastProcessedCandle);
    }
  }

  async runCycle(): Promise<void> {
    const persistedPaused = this.options.persistence
      ? await this.options.persistence.isPaused()
      : false;
    if (persistedPaused) this.observedPaused = true;
    if (this.observedPaused && !persistedPaused) {
      this.consecutiveLosses = 0;
      this.stopLossCooldownUntil = 0;
      this.observedPaused = false;
      console.log(JSON.stringify({ event: "risk_latch_reset", reason: "operator_resume" }));
    }
    if (this.demoExecutionBlocked || persistedPaused) {
      console.log(
        JSON.stringify({ event: "cycle_skipped", reason: "bot_paused" }),
      );
      return;
    }

    const candles = await this.market.fetchClosedCandles(
      this.options.symbol,
      this.options.candleLimit,
    );
    await this.recordServiceStatus(`market-data-${this.market.active}`, "ok");
    const latest = candles.at(-1);
    if (!latest) throw new Error("Market data provider returned no closed candles");

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
    // No eligible candidate means no entry is allowed. In particular, a BUY
    // signal with insufficient market quality must not fall through merely
    // because the ranking has no selected symbol.
    const managedPositionSymbol = this.options.tradeManager?.activePositions[0]?.symbol;
    const executionSymbol = managedPositionSymbol ?? selectedEligibleSymbol ?? this.options.symbol;
    const paperTrader = await this.getPaperTrader(executionSymbol);
    const executionCandles = executionSymbol === this.options.symbol
      ? candles
      : await this.market.fetchClosedCandles(executionSymbol, this.options.candleLimit);
    const executionLatest = executionCandles.at(-1);
    if (!executionLatest) throw new Error(`Market data provider returned no closed candles for ${executionSymbol}`);
    const lastProcessedCandle = this.lastProcessedCandleBySymbol.get(executionSymbol);
    const unseenCandles = lastProcessedCandle === undefined
      ? [executionLatest]
      : executionCandles.filter((candle) => candle.timestamp > lastProcessedCandle);
    if (unseenCandles.length === 0) {
      console.log(JSON.stringify({ event: "cycle_skipped", reason: "candle_already_processed", symbol: executionSymbol }));
      return;
    }
    const currentSymbolSelected = selectedEligibleSymbol !== undefined || managedPositionSymbol !== undefined;

    // Replayed candles can close an existing position, but cannot create a
    // retrospective entry. Approval is calculated only for the newest candle.
    for (const candle of unseenCandles.slice(0, -1)) {
      const previousState = paperTrader.exportState();
      const paperResult = paperTrader.processCandle(candle, false);
      await this.applyLossControls(paperResult.events, candle.timestamp);
      if (paperResult.events.some((event) => event.type === "CLOSED")) {
        this.options.tradeManager?.recordExit(executionSymbol);
      }
      try {
        await this.options.persistence?.recordCycle({
          symbol: executionSymbol,
          candle,
          replayed: true,
          paperResult,
          paperState: paperTrader.exportState(),
          riskState: this.exportRiskState(),
        });
      } catch (error) {
        paperTrader.restoreState(previousState);
        throw error;
      }
      this.logPaperResult(candle, paperResult, true, executionSymbol);
      await this.sendTradeAlerts(paperResult.events, true);
      this.lastProcessedCandleBySymbol.set(executionSymbol, candle.timestamp);
    }

    const currentCandle = unseenCandles.at(-1)!;
    const currentIndex = executionCandles.findIndex(
      (candle) => candle.timestamp === currentCandle.timestamp,
    );
    const signalCandles = executionCandles.slice(0, currentIndex + 1);
    const exitRates = this.calculateVolatilityExitRates(signalCandles, currentCandle.close, paperTrader);
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

    let cooldownBlocked = false;
    const stopLossCooldownBlocked = currentCandle.timestamp < this.stopLossCooldownUntil;
    if (signal.action === "BUY" && currentSymbolSelected && this.options.entryCooldownMinutes !== undefined) {
      const cooldownMs = this.options.entryCooldownMinutes * 60_000;
      if (this.options.persistence && typeof this.options.persistence.canEnterSymbol === "function") {
        cooldownBlocked = !(await this.options.persistence.canEnterSymbol(executionSymbol, this.options.entryCooldownMinutes));
      } else {
        const lastEntryAt = this.lastEntryAtBySymbol.get(executionSymbol);
        cooldownBlocked = lastEntryAt !== undefined && currentCandle.timestamp - lastEntryAt < cooldownMs;
      }
    }
    if (stopLossCooldownBlocked) {
      await this.recordOperationalEvent("STOP_LOSS_COOLDOWN", "INFO", {
        cooldownUntil: this.stopLossCooldownUntil,
      });
    }
    if (cooldownBlocked || stopLossCooldownBlocked) {
      await this.recordOperationalEvent("COOLDOWN_BLOCK", "INFO", {
        cooldownMinutes: this.options.entryCooldownMinutes,
      });
      console.log(JSON.stringify({
        event: "trade_blocked_by_cooldown",
        symbol: executionSymbol,
        cooldownMinutes: this.options.entryCooldownMinutes,
      }));
    }

    if (signal.action === "BUY" && currentSymbolSelected && !cooldownBlocked && !stopLossCooldownBlocked && this.options.ai) {
      try {
        aiDecision = await this.options.ai.evaluate(signal);
      } catch (error) {
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
        // A transient AI outage rejects only this entry. The next candle
        // retries the filter instead of permanently pausing the bot.
        aiDecision = {
          approve: false,
          confidence: 0,
          reason: "AI unavailable; entry rejected for this cycle",
        };
      }
    }

    let approved =
      signal.action === "BUY" &&
      aiDecision.approve &&
      aiDecision.confidence >= this.options.minimumConfidence &&
      currentSymbolSelected &&
      !cooldownBlocked &&
      !stopLossCooldownBlocked &&
      this.consecutiveLosses < (this.options.maxConsecutiveLosses ?? Number.POSITIVE_INFINITY);

    const managerBlock = approved && this.options.tradeManager
      ? this.options.tradeManager.canEnter(
          executionSymbol,
          this.options.demoExecutor
            ? this.options.demoOrderSizeUsdt ?? paperTrader.tradeSizeUsdt
            : paperTrader.tradeSizeUsdt,
        this.paperEquityEstimate(executionSymbol),
        ).reason
      : undefined;
    const riskBlock = approved
      ? managerBlock ?? this.riskBlockReason(exitRates, paperTrader)
      : undefined;
    if (riskBlock) {
      approved = false;
      console.log(JSON.stringify({
        event: "trade_blocked_by_risk",
        symbol: executionSymbol,
        reason: riskBlock,
      }));
      await this.recordOperationalEvent("RISK_LIMIT", "WARN", { reason: riskBlock });
    }

    const previousState = paperTrader.exportState();
    const paperResult = paperTrader.processCandle(
      currentCandle,
      approved,
      exitRates,
    );
    await this.applyLossControls(paperResult.events, currentCandle.timestamp);
    try {
      await this.options.persistence?.recordCycle({
        symbol: executionSymbol,
        candle: currentCandle,
        replayed: false,
        paperResult,
        paperState: paperTrader.exportState(),
        riskState: this.exportRiskState(),
        decision: {
          mode: this.options.demoExecutor ? "PAPER_WITH_OKX_DEMO" : "PAPER",
          signal,
          aiDecision,
          approved,
        },
      });
      await this.recordServiceStatus("postgresql", "ok");
    } catch (error) {
      paperTrader.restoreState(previousState);
      throw error;
    }
    if (paperResult.events.some((event) => event.type === "OPENED")) {
      this.lastEntryAtBySymbol.set(executionSymbol, currentCandle.timestamp);
      this.options.tradeManager?.recordEntry({
        symbol: executionSymbol,
        notionalUsdt: this.options.demoExecutor
          ? this.options.demoOrderSizeUsdt ?? paperTrader.tradeSizeUsdt
          : paperTrader.tradeSizeUsdt,
        openedAt: currentCandle.timestamp,
      });
    }
    if (paperResult.events.some((event) => event.type === "CLOSED")) {
      this.options.tradeManager?.recordExit(executionSymbol);
    }
    this.lastProcessedCandleBySymbol.set(executionSymbol, currentCandle.timestamp);

    await this.updateDailyRiskBaseline(executionSymbol, paperResult.snapshot.equityUsdt);
    const dailyStartEquity = this.dailyStartEquityBySymbol.get(executionSymbol) ?? paperResult.snapshot.equityUsdt;
    const dailyLossPercent = dailyStartEquity
      ? Math.max(0, (dailyStartEquity - paperResult.snapshot.equityUsdt) / dailyStartEquity)
      : 0;
    if (
      this.options.persistence &&
      ((this.options.maxDrawdownPercent !== undefined &&
        paperResult.snapshot.currentDrawdownPercent >= this.options.maxDrawdownPercent * 100) ||
        (this.options.maxDailyLossPercent !== undefined && dailyLossPercent >= this.options.maxDailyLossPercent))
    ) {
      await this.options.persistence.setPaused(true, "system:risk_limit");
      console.log(JSON.stringify({
        event: "risk_pause_triggered",
        symbol: executionSymbol,
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
              symbol: executionSymbol,
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
            symbol: executionSymbol,
            candleTimestamp: currentCandle.timestamp,
            ...exitRates,
          });
          try {
            await this.options.persistence?.recordDemoOrder(
              executionSymbol,
              currentCandle.timestamp,
              demoResult,
            );
            await this.recordServiceStatus("postgresql", "ok");
          } catch (error) {
            console.error(
              JSON.stringify({
                event: "database_write_failed_after_order",
                symbol: executionSymbol,
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
              symbol: executionSymbol,
              result: demoResult,
            }),
          );
          await this.recordServiceStatus("okx-demo", "ok");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          await this.options.persistence?.recordDemoOrderFailure(
            executionSymbol,
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
            symbol: executionSymbol,
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
          symbol: executionSymbol,
          reason: "paper_position_not_opened",
          paperEvents: paperResult.events.map((event) => event.type),
        }),
      );
    }

    console.log(
      JSON.stringify({
        event: "decision",
        mode: this.options.demoExecutor ? "PAPER_WITH_OKX_DEMO" : "PAPER",
        symbol: executionSymbol,
        signal,
        aiDecision,
        approved,
        selectedSignalSymbol: selectedEligibleSymbol ?? null,
        execution: this.options.demoExecutor
          ? "paper_with_optional_okx_demo"
          : "simulated",
      }),
    );

    this.logPaperResult(currentCandle, paperResult, false, executionSymbol);
    await this.sendTradeAlerts(paperResult.events, false);
  }

  private exportRiskState(): { consecutiveLosses: number; stopLossCooldownUntil: number } {
    return { consecutiveLosses: this.consecutiveLosses, stopLossCooldownUntil: this.stopLossCooldownUntil };
  }

  private async applyLossControls(events: PaperCycleResult["events"], candleTimestamp: number): Promise<void> {
    for (const event of events) {
      if (event.type !== "CLOSED") continue;
      if (event.netPnlUsdt < 0) {
        this.consecutiveLosses += 1;
        if (event.reason === "STOP_LOSS") {
          this.stopLossCooldownUntil = Math.max(
            this.stopLossCooldownUntil,
            candleTimestamp + (this.options.stopLossCooldownMinutes ?? 0) * 60_000,
          );
        }
      } else {
        this.consecutiveLosses = 0;
      }
    }
    if (this.consecutiveLosses >= (this.options.maxConsecutiveLosses ?? Number.POSITIVE_INFINITY)) {
      await this.options.persistence?.setPaused(true, "system:consecutive_losses");
      this.observedPaused = true;
      console.log(JSON.stringify({
        event: "risk_pause_triggered",
        symbol: this.options.symbol,
        reason: "max_consecutive_losses",
        consecutiveLosses: this.consecutiveLosses,
      }));
    }
  }

  private async getPaperTrader(symbol: string): Promise<PaperTrader> {
    const existing = this.paperTraders.get(symbol);
    if (existing && this.loadedPaperSymbols.has(symbol)) return existing;
    const trader = new PaperTrader(this.options.paperTrader.configuration);
    const recovery = await this.options.persistence?.loadRecoveryState?.(symbol);
    if (recovery && recovery.symbol === symbol) {
      trader.restoreState(recovery.paperState);
      this.lastProcessedCandleBySymbol.set(symbol, recovery.lastProcessedCandle);
    }
    this.paperTraders.set(symbol, trader);
    this.loadedPaperSymbols.add(symbol);
    return trader;
  }

  private paperEquityEstimate(symbol = this.options.symbol): number {
    return this.paperTraders.get(symbol)?.exportState().cashUsdt ?? this.options.paperTrader.exportState().cashUsdt;
  }

  private async scanSignals(currentCandles: Candle[]): Promise<RankedSignal[]> {
    let dynamicSymbols: string[] = [];
    if (this.options.dynamicUniverseSize && typeof this.market.selectSpotSymbols === "function") {
      try {
        dynamicSymbols = await this.market.selectSpotSymbols({
            limit: this.options.dynamicUniverseSize,
            minQuoteVolume: this.options.marketMinQuoteVolumeUsdt ?? 1_000_000,
            maxSpreadPercent: this.options.marketMaxSpreadPercent ?? 1,
          });
      } catch (error) {
        console.error(JSON.stringify({
          event: "dynamic_universe_scan_failed",
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    const configuredSymbols = [this.options.symbol, ...(this.options.signalScanSymbols ?? [])];
    const universeSize = this.options.dynamicUniverseSize ?? 10;
    const discoveredUniverse = [...new Set([
      ...configuredSymbols,
      ...dynamicSymbols,
    ])];
    const symbols = [...new Set([
      ...configuredSymbols,
      ...this.activeUniverse,
      ...discoveredUniverse,
    ])];
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

    const blockedSymbols = new Set(this.options.tradeManager?.activePositions.map((position) => position.symbol));
    const ranked = rankSignals(candidates, this.options.minimumSignalScore, blockedSymbols);
    const activeSymbols = await this.updateUniverse(ranked, configuredSymbols, currentCandles.at(-1)?.timestamp ?? Date.now(), universeSize);
    return ranked.filter((candidate) => activeSymbols.has(candidate.symbol));
  }

  private async updateUniverse(
    ranked: RankedSignal[],
    configuredSymbols: string[],
    candleTimestamp: number,
    universeSize: number,
  ): Promise<Set<string>> {
    const configured = new Set(configuredSymbols);
    if (this.activeUniverse.length === 0) {
      const rankedSymbols = ranked.map((candidate) => candidate.symbol);
      this.activeUniverse = [...new Set([
        ...configuredSymbols,
        ...rankedSymbols.filter((symbol) => !configured.has(symbol)).slice(0, universeSize),
      ])];
      this.lastUniverseSwitchAt = candleTimestamp;
      return new Set(this.activeUniverse);
    }

    const cooldownMs = (this.options.universeSwitchCooldownMinutes ?? 60) * 60_000;
    if (candleTimestamp - this.lastUniverseSwitchAt < cooldownMs) return new Set(this.activeUniverse);

    const bySymbol = new Map(ranked.map((candidate) => [candidate.symbol, candidate]));
    const outside = ranked
      .filter((candidate) => !this.activeUniverse.includes(candidate.symbol))
      .sort((left, right) => right.signal.score - left.signal.score);
    let replacements = 0;
    const minAdvantage = this.options.universeSwitchMinScoreAdvantage ?? 1;
    const maxReplacements = this.options.universeMaxReplacements ?? 2;
    const unavailable = this.activeUniverse.filter(
      (symbol) => !configured.has(symbol) && !bySymbol.has(symbol),
    );
    for (const symbol of unavailable.slice(0, maxReplacements)) {
      this.activeUniverse = this.activeUniverse.filter((active) => active !== symbol);
      replacements += 1;
    }
    while (replacements < maxReplacements && outside.length > 0) {
      const weakest = this.activeUniverse
        .filter((symbol) => !configured.has(symbol))
        .map((symbol) => bySymbol.get(symbol))
        .filter((candidate): candidate is RankedSignal => Boolean(candidate))
        .sort((left, right) => left.signal.score - right.signal.score)[0];
      const strongest = outside[0];
      if (!weakest || !strongest || strongest.signal.score < weakest.signal.score + minAdvantage) break;
      this.activeUniverse = this.activeUniverse.filter((symbol) => symbol !== weakest.symbol);
      this.activeUniverse.push(strongest.symbol);
      outside.shift();
      replacements += 1;
    }
    if (replacements > 0) {
      this.lastUniverseSwitchAt = candleTimestamp;
      const details = {
        reason: "stronger_signal_replaced_weaker_pair",
        replacements,
        activeSymbols: this.activeUniverse,
        minScoreAdvantage: minAdvantage,
      };
      console.log(JSON.stringify({ event: "universe_switched", ...details }));
      await this.options.persistence?.recordOperationalEvent({
        eventType: "UNIVERSE_SWITCHED",
        severity: "INFO",
        symbol: this.options.symbol,
        details,
      });
    }
    return new Set(this.activeUniverse);
  }

  private async updateDailyRiskBaseline(symbol: string, equity: number): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    if (date !== this.dailyDate) {
      this.dailyDate = date;
      this.dailyStartEquityBySymbol.set(symbol, await this.options.persistence?.getDailyStartEquity?.(symbol) ?? equity);
    } else {
      if (!this.dailyStartEquityBySymbol.has(symbol)) {
        this.dailyStartEquityBySymbol.set(symbol, await this.options.persistence?.getDailyStartEquity?.(symbol) ?? equity);
      }
    }
  }

  private calculateVolatilityExitRates(candles: Candle[], referencePrice: number, trader = this.options.paperTrader): { stopLossRate: number; takeProfitRate: number } {
    const atr = averageTrueRange(candles, this.options.atrPeriod ?? 14);
    if (atr <= 0) {
      return {
        stopLossRate: this.options.fallbackStopLossRate ?? trader.stopLossRate,
        takeProfitRate: this.options.fallbackTakeProfitRate ?? 0.02,
      };
    }
    const volatilityRate = atr > 0 ? atr / referencePrice : trader.stopLossRate;
    const stopLossRate = Math.min(this.options.atrMaxStopRate ?? 0.03, Math.max(this.options.atrMinStopRate ?? 0.005, volatilityRate * (this.options.atrStopMultiplier ?? 1.5)));
    const takeProfitRate = Math.min(0.5, Math.max(stopLossRate, volatilityRate * (this.options.atrTakeProfitMultiplier ?? 3)));
    return { stopLossRate, takeProfitRate };
  }

  private riskBlockReason(exitRates: { stopLossRate: number; takeProfitRate: number }, trader: PaperTrader): string | undefined {
    const traderState = trader.exportState();
    if (traderState.position) return "position_already_open";
    const balance = Math.max(traderState.peakEquityUsdt, traderState.cashUsdt);
    const tradeSize = this.options.demoExecutor && this.options.demoOrderSizeUsdt !== undefined
      ? this.options.demoOrderSizeUsdt
      : trader.tradeSizeUsdt;
    if (this.options.maxExposurePercent !== undefined && tradeSize / balance > this.options.maxExposurePercent) {
      return "max_exposure_percent";
    }
    if (this.options.riskPerTradePercent !== undefined) {
      const estimatedRisk = tradeSize * exitRates.stopLossRate;
      if (estimatedRisk / balance > this.options.riskPerTradePercent) return "risk_per_trade_percent";
    }
    return undefined;
  }

  private logPaperResult(
    candle: Candle,
    result: PaperCycleResult,
    replayed: boolean,
    symbol: string,
  ): void {
    for (const event of result.events) {
      console.log(
        JSON.stringify({
          event:
            event.type === "OPENED"
              ? "paper_trade_opened"
              : "paper_trade_closed",
          symbol,
          replayed,
          trade: event,
        }),
      );
    }

    console.log(
      JSON.stringify({
        event: "paper_portfolio_snapshot",
        symbol,
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
