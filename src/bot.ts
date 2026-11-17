import type { FilledDemoBuy } from "./demo-exit-supervisor.js";
import type { PairCooldown } from "./pair-cooldown.js";
import type { DemoAdmission } from "./demo-entry.js";
import { BTC_REGIME_HISTORY, REGIME_CANDLE_MS, btcRegimeBlock } from "./btc-regime.js";
import { initialExitRates, type ExitPolicy } from "./exit-policy.js";
import type { PublicMarketData } from "./market-data.js";
import type { GeminiRiskFilter } from "./gemini.js";
import { PaperTrader, type PaperCycleResult } from "./paper-trader.js";
import type { DemoEntryMarketCheck, OkxDemoExecutor } from "./okx-demo.js";
import type { BotPersistence, PersistedCycle } from "./persistence.js";
import { evaluateStrategy } from "./strategy.js";
import { rankSignals, type RankedSignal } from "./signal-ranking.js";
import { averageTrueRange } from "./indicators.js";
import type { AiDecision, Candle } from "./types.js";
import type { EmailTradeAlert } from "./email-alerts.js";
import type { CentralTradeManager } from "./trade-manager.js";

type BotOptions = {
  symbol: string;
  candleLimit: number;
  btcRegimeFilter?: boolean;
  minimumConfidence: number;
  aiFailureMode?: "reject" | "quantitative";
  minimumSignalScore?: number;
  signalScanSymbols?: string[];
  dynamicUniverseSize?: number;
  pairCooldown?: PairCooldown;
  marketMinQuoteVolumeUsdt?: number;
  marketMaxSpreadPercent?: number;
  universeSwitchCooldownMinutes?: number;
  universeSwitchMinScoreAdvantage?: number;
  universeMaxReplacements?: number;
  paperTrader: PaperTrader;
  demoExecutor?: Pick<OkxDemoExecutor, "executeApprovedBuy"> & Partial<Pick<OkxDemoExecutor, "executeApprovedSell">>;
  inspectEntryMarket?: (symbol: string) => Promise<DemoEntryMarketCheck>;
  verifyFilledDemoBuy?: (buy: FilledDemoBuy) => Promise<{ status: "safe" } | { status: "blocked"; reason: string }>;
  verifyDemoExecutionSafety?: () => Promise<{ status: "safe" } | { status: "blocked"; reason: string }>;
  inspectDemoEntry?: (symbol: string, stopLossRate: number) => Promise<DemoAdmission>;
  inspectDemoPositions?: () => Promise<{ status: "safe"; positions: Array<{ symbol: string }> } | { status: "blocked"; reason: string }>;
  ai?: GeminiRiskFilter;
  persistence?: BotPersistence;
  initialLastProcessedCandle?: number;
  initialRiskState?: { consecutiveLosses: number; stopLossCooldownUntil: number };
  maxTradesPerInterval?: number;
  tradeIntervalMinutes?: number;
  exitPolicy?: ExitPolicy;
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
  private readonly lastTradeAtBySymbol = new Map<string, number>();
  private consecutiveLosses: number;
  private stopLossCooldownUntil: number;
  private observedPaused = false;
  private readonly reportedPaperGaps = new Map<string, number>();
  private demoOccupiedSymbols = new Set<string>();
  private activeUniverse: string[] = [];
  private lastScan: { pairs: string[]; candleTimestamp: number; cooldowns: Array<{ symbol: string; until: number }> } | null = null;
  private scanCache?: {
    timestamp: number;
    provider: string;
    discovered?: string[];
    candles: Map<string, Candle[]>;
    rankingKey?: string;
    ranking?: RankedSignal[];
  };
  private lastLoggedRanking?: string;

  getLastSignalScan() { return this.lastScan; }
  private lastUniverseSwitchAt = 0;
  private readonly paperTraders = new Map<string, PaperTrader>();
  private readonly loadedPaperSymbols = new Set<string>();
  private readonly lastProcessedCandleBySymbol = new Map<string, number>();

  /** Only call after the exchange safety gate and persistent resume succeed. */
  clearDemoExecutionBlock(): void { this.demoExecutionBlocked = false; }

  resetAfterAutomaticResume(): void {
    this.clearDemoExecutionBlock();
    this.consecutiveLosses = 0;
    this.observedPaused = false;
  }

  constructor(
    private readonly market: PublicMarketData,
    private readonly options: BotOptions,
  ) {
    if (options.pairCooldown && !options.persistence?.activePairCooldowns) {
      throw new Error("Pair cooldown requires persisted Paper trade history");
    }
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
    const control = await this.options.persistence?.readControlState?.();
    const persistedPaused = control?.paused ?? await this.options.persistence?.isPaused() ?? false;
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

    // Monitor an existing Demo position even when the strategy has no new BUY.
    if (this.options.demoExecutor && this.options.verifyDemoExecutionSafety) {
      const safety = await this.options.verifyDemoExecutionSafety();
      if (safety.status !== "safe") {
        this.demoExecutionBlocked = true;
        await this.options.persistence?.setPaused(true, "system:demo_execution_safety", safety.reason);
        await this.recordOperationalEvent("DEMO_ENTRY_DECISION", "WARN", { symbol: this.options.symbol, approved: false, reason: safety.reason });
        console.error(JSON.stringify({ event: "demo_execution_blocked", reason: safety.reason }));
        return;
      }
    }

    if (this.options.inspectDemoPositions) {
      const state = await this.options.inspectDemoPositions();
      if (state.status !== "safe") {
        this.demoExecutionBlocked = true;
        await this.options.persistence?.setPaused(true, "system:demo_position_uncertain", state.reason);
        return;
      }
      this.demoOccupiedSymbols = new Set(state.positions.map(position => position.symbol));
    }
    const candles = await this.market.fetchClosedCandles(
      this.options.symbol,
      this.options.candleLimit,
    );
    await this.recordServiceStatus(`market-data-${this.market.active}`, "ok");
    const latest = candles.at(-1);
    if (!latest) throw new Error("Market data provider returned no closed candles");

    const cooldowns = this.options.pairCooldown
      ? await this.options.persistence!.activePairCooldowns!(Date.now(), this.options.pairCooldown)
      : [];
    const pausedPairs = new Set(cooldowns.map(item => item.symbol));
    const { ranking, requests } = await this.scanSignals(candles, pausedPairs);
    this.lastScan = { pairs: ranking.map(candidate => candidate.symbol), candleTimestamp: latest.timestamp, cooldowns };
    const rankingKey = JSON.stringify([latest.timestamp, ranking.map(({ symbol, eligible, signal }) => [symbol, eligible, signal.action, signal.score])]);
    if (ranking.length > 0 && rankingKey !== this.lastLoggedRanking) {
      this.lastLoggedRanking = rankingKey;
      console.log(JSON.stringify({
        event: "signal_ranking",
        candleTimestamp: latest.timestamp,
        scanRequests: requests,
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
    const executionSymbol = this.options.inspectDemoEntry
      ? selectedEligibleSymbol ?? managedPositionSymbol ?? this.options.symbol
      : managedPositionSymbol ?? selectedEligibleSymbol ?? this.options.symbol;
    await this.monitorOtherPaperPositions(executionSymbol, control?.revision);
    if (this.observedPaused) return;
    const paperTrader = await this.getPaperTrader(executionSymbol);
    const executionCandles = executionSymbol === this.options.symbol
      ? candles
      : await this.market.fetchClosedCandles(executionSymbol, this.options.candleLimit);
    const executionLatest = executionCandles.at(-1);
    if (!executionLatest) throw new Error(`Market data provider returned no closed candles for ${executionSymbol}`);
    const lastProcessedCandle = this.lastProcessedCandleBySymbol.get(executionSymbol);
    const paperCursor = lastProcessedCandle ?? paperTrader.exportState().position?.entryTimestamp;
    const unseenCandles = paperCursor === undefined
      ? [executionLatest]
      : executionCandles.filter((candle) => candle.timestamp > paperCursor);
    if (await this.paperHistoryGap(paperTrader, executionSymbol, paperCursor, unseenCandles)) return;
    if (unseenCandles.length === 0) {
      console.log(JSON.stringify({ event: "cycle_skipped", reason: "candle_already_processed", symbol: executionSymbol }));
      return;
    }
    let pairPaused = pausedPairs.has(executionSymbol);
    let replayedLoss = false;

    // Replayed candles can close an existing position, but cannot create a
    // retrospective entry. Approval is calculated only for the newest candle.
    for (const candle of unseenCandles.slice(0, -1)) {
      const previousState = paperTrader.exportState();
      const riskBefore = this.exportRiskState();
      const replayIndex = executionCandles.findIndex((item) => item.timestamp === candle.timestamp);
      const replaySignal = replayIndex >= 49
        ? evaluateStrategy(executionCandles.slice(0, replayIndex + 1), this.options.minimumSignalScore === undefined ? undefined : { minimumScore: this.options.minimumSignalScore })
        : undefined;
      const paperResult = paperTrader.processCandle(candle, false, undefined, replaySignal?.action === "SELL" && paperTrader.hasOpenPosition);
      paperTrader.advanceManagedExit(executionCandles.slice(0, replayIndex + 1));
      const lossPause = this.applyLossControls(paperResult.events, candle.timestamp);
      try {
        await this.persistPaperCycle({
          symbol: executionSymbol,
          candle,
          replayed: true,
          paperResult,
          paperState: paperTrader.exportState(),
          riskState: this.exportRiskState(),
        }, lossPause, control?.revision);
      } catch (error) {
        paperTrader.restoreState(previousState);
        this.restoreRiskState(riskBefore);
        throw error;
      }
      replayedLoss ||= paperResult.events.some(event => event.type === "CLOSED" && event.netPnlUsdt < 0);
      this.logPaperResult(candle, paperResult, true, executionSymbol);
      await this.sendTradeAlerts(executionSymbol, paperResult.events, true);
      this.lastProcessedCandleBySymbol.set(executionSymbol, candle.timestamp);
      if (paperResult.events.some(event => event.type === "CLOSED")) {
        this.lastTradeAtBySymbol.set(executionSymbol, candle.timestamp);
        this.options.tradeManager?.recordExit(executionSymbol);
      }
      if (lossPause) return;
    }

    if (this.options.pairCooldown && replayedLoss) {
      pairPaused = await this.refreshPairCooldown(executionSymbol);
    }
    const currentSymbolSelected = !pairPaused &&
      (selectedEligibleSymbol !== undefined || managedPositionSymbol !== undefined);
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
    let aiFallbackUsed = false;

    let cooldownBlocked = false;
    const stopLossCooldownBlocked = currentCandle.timestamp < this.stopLossCooldownUntil;
    if (signal.action === "BUY" && currentSymbolSelected && this.options.entryCooldownMinutes !== undefined) {
      const cooldownMs = this.options.entryCooldownMinutes * 60_000;
      if (this.options.persistence && typeof this.options.persistence.canEnterSymbol === "function") {
        cooldownBlocked = !(await this.options.persistence.canEnterSymbol(executionSymbol, this.options.entryCooldownMinutes));
      } else {
        const lastTradeAt = this.lastTradeAtBySymbol.get(executionSymbol);
        cooldownBlocked = lastTradeAt !== undefined && currentCandle.timestamp - lastTradeAt < cooldownMs;
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

    if (signal.action === "BUY" && currentSymbolSelected && (!cooldownBlocked || this.options.inspectDemoEntry) && !stopLossCooldownBlocked && this.options.ai) {
      try {
        aiDecision = await withTimeout(this.options.ai.evaluate(signal), 8_000, "Gemini request timed out");
        await this.recordServiceStatus("gemini", "ok");
      } catch (error) {
        const fallbackMode = this.options.aiFailureMode === "quantitative" ? "quantitative" : "reject";
        console.error(
          JSON.stringify({
            event: "ai_unavailable_quantitative_fallback",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        await this.recordOperationalEvent("AI_UNAVAILABLE", "WARN", {
          error: error instanceof Error ? error.message : String(error),
          configuredFailureMode: fallbackMode,
        });
        await this.recordServiceStatus("gemini", "unhealthy", error);
        // A transient AI outage rejects only this entry. The next candle
        // retries the filter instead of permanently pausing the bot.
        aiDecision = {
          approve: false,
          confidence: 0,
          reason: fallbackMode === "quantitative"
            ? "AI_UNAVAILABLE; quantitative fallback selected"
            : "AI_UNAVAILABLE; entry rejected by configured failure mode",
        };
        aiFallbackUsed = true;
      }
    }

    // AI is a risk filter, never a hard dependency. In the configured
    // quantitative mode, a disabled/unavailable filter falls back to the
    // already validated signal and remains subject to all risk controls.
    const quantitativeFallback =
      signal.action === "BUY" &&
      this.options.aiFailureMode === "quantitative" &&
      (!this.options.ai || aiFallbackUsed);

    let approved =
      signal.action === "BUY" &&
      (quantitativeFallback || (aiDecision.approve && aiDecision.confidence >= this.options.minimumConfidence)) &&
      currentSymbolSelected &&
      !cooldownBlocked &&
      !stopLossCooldownBlocked &&
      this.consecutiveLosses < (this.options.maxConsecutiveLosses ?? Number.POSITIVE_INFINITY);

    // Demo admission is independent of Paper position and Paper cooldown.
    // Shared loss latches remain conservative circuit breakers.
    let demoCandidate = Boolean(this.options.inspectDemoEntry) &&
      signal.action === "BUY" && currentSymbolSelected &&
      (quantitativeFallback || (aiDecision.approve && aiDecision.confidence >= this.options.minimumConfidence)) &&
      !stopLossCooldownBlocked && this.consecutiveLosses < (this.options.maxConsecutiveLosses ?? Number.POSITIVE_INFINITY);

    const regimeBlock = this.options.btcRegimeFilter && (approved || demoCandidate)
      ? await this.inspectBtcRegime(currentCandle.timestamp)
      : undefined;
    if (regimeBlock) {
      approved = false;
      demoCandidate = false;
      await this.recordOperationalEvent("BTC_REGIME_ENTRY_BLOCKED", "INFO", {
        symbol: executionSymbol, candleTimestamp: currentCandle.timestamp, reason: regimeBlock,
      });
    }

    const riskSizing = paperTrader.configuration.riskSizing;
    const positions = this.options.tradeManager?.activePositions ?? [];
    const plannedPaperSize = riskSizing ? paperTrader.planEntrySize(
      exitRates.stopLossRate,
      executionSymbol.split("/")[0] !== "BTC",
      this.options.tradeManager?.totalExposureUsdt ?? 0,
      positions.filter(p => p.symbol.split("/")[0] !== "BTC").reduce((sum, p) => sum + p.notionalUsdt, 0),
    ) : undefined;
    const managerBlock = approved && this.options.tradeManager
      ? this.options.tradeManager.canEnter(
          executionSymbol,
          plannedPaperSize ?? paperTrader.tradeSizeUsdt,
        this.paperEquityEstimate(executionSymbol),
        ).reason
      : undefined;
    const riskBlock = approved
      ? managerBlock ?? (plannedPaperSize === undefined ? this.riskBlockReason(exitRates, paperTrader) : plannedPaperSize <= 0 ? "paper_risk_size_unavailable" : undefined)
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

    if (approved && this.options.demoExecutor && this.options.verifyDemoExecutionSafety) {
      const safety = await this.options.verifyDemoExecutionSafety();
      if (safety.status !== "safe") {
        approved = false;
        this.demoExecutionBlocked = true;
        await this.options.persistence?.setPaused(true, "system:demo_execution_safety", safety.reason);
        console.error(JSON.stringify({ event: "demo_execution_blocked", reason: safety.reason }));
      }
    }

    const marketCheck = this.options.inspectEntryMarket && ((approved && !paperTrader.hasOpenPosition) || demoCandidate)
      ? await this.options.inspectEntryMarket(executionSymbol)
      : undefined;
    const marketBlock = marketCheck?.status === "blocked" ? marketCheck.reason : undefined;
    if (marketCheck) {
      await this.recordOperationalEvent("ENTRY_MARKET_CHECK", marketBlock ? "WARN" : "INFO", {
        symbol: executionSymbol, candleTimestamp: currentCandle.timestamp, allowed: !marketBlock,
        ...(marketBlock ? { reason: marketBlock } : {}),
      });
    }
    if (marketBlock) {
      approved = false;
      demoCandidate = false;
    }

    const previousState = paperTrader.exportState();
    const riskBefore = this.exportRiskState();
    const paperResult = paperTrader.processCandle(
      currentCandle,
      approved,
      exitRates,
      !this.options.exitPolicy && signal.action === "SELL" && paperTrader.hasOpenPosition,
      undefined,
      plannedPaperSize,
    );
    paperTrader.advanceManagedExit(signalCandles);
    const lossPause = this.applyLossControls(paperResult.events, currentCandle.timestamp);
    try {
      await this.persistPaperCycle({
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
      }, lossPause, control?.revision);
    } catch (error) {
      paperTrader.restoreState(previousState);
      this.restoreRiskState(riskBefore);
      throw error;
    }
    await this.recordServiceStatus("postgresql", "ok");
    const opened = paperResult.events.find((event) => event.type === "OPENED");
    if (opened) {
      this.lastTradeAtBySymbol.set(executionSymbol, currentCandle.timestamp);
      this.options.tradeManager?.recordEntry({
        symbol: executionSymbol,
        notionalUsdt: opened.notionalUsdt,
        openedAt: currentCandle.timestamp,
      });
      await this.recordOperationalEvent("PAPER_ENTRY_OPENED", "INFO", {
        symbol: executionSymbol, candleTimestamp: currentCandle.timestamp, paperNotionalUsdt: opened.notionalUsdt,
      });
    }
    if (paperResult.events.some((event) => event.type === "CLOSED")) {
      this.lastTradeAtBySymbol.set(executionSymbol, currentCandle.timestamp);
      this.options.tradeManager?.recordExit(executionSymbol);
    }

    const contraryClose = paperResult.events.find((event) => event.type === "CLOSED" && event.reason === "SIGNAL_CONTRARY");
    if (contraryClose && this.options.demoExecutor?.executeApprovedSell) {
      try {
        const demoResult = await this.options.demoExecutor.executeApprovedSell({
          symbol: executionSymbol,
          candleTimestamp: currentCandle.timestamp,
          quantity: contraryClose.quantity,
        });
        await this.options.persistence?.recordDemoOrder(executionSymbol, currentCandle.timestamp, demoResult);
        console.log(JSON.stringify({ event: "okx_demo_sell_submitted", symbol: executionSymbol, result: demoResult }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.options.persistence?.recordDemoOrderFailure(executionSymbol, currentCandle.timestamp, message);
        console.error(JSON.stringify({ event: "okx_demo_sell_failed", symbol: executionSymbol, error: message }));
      }
    }
    this.lastProcessedCandleBySymbol.set(executionSymbol, currentCandle.timestamp);

    await this.updateDailyRiskBaseline(executionSymbol, paperResult.snapshot.equityUsdt);
    const dailyStartEquity = this.dailyStartEquityBySymbol.get(executionSymbol) ?? paperResult.snapshot.equityUsdt;
    const dailyLossPercent = dailyStartEquity
      ? Math.max(0, (dailyStartEquity - paperResult.snapshot.equityUsdt) / dailyStartEquity)
      : 0;
    if (
      !lossPause && this.options.persistence &&
      ((this.options.maxDrawdownPercent !== undefined &&
        paperResult.snapshot.currentDrawdownPercent >= this.options.maxDrawdownPercent * 100) ||
        (this.options.maxDailyLossPercent !== undefined && dailyLossPercent >= this.options.maxDailyLossPercent))
    ) {
      const drawdownExceeded = this.options.maxDrawdownPercent !== undefined &&
        paperResult.snapshot.currentDrawdownPercent >= this.options.maxDrawdownPercent * 100;
      await this.options.persistence.setPaused(true, "system:risk_limit", drawdownExceeded ? "paper_drawdown_limit" : "paper_daily_loss_limit");
      console.log(JSON.stringify({
        event: "risk_pause_triggered",
        symbol: executionSymbol,
        currentDrawdownPercent: paperResult.snapshot.currentDrawdownPercent,
        dailyLossPercent,
      }));
    }

    if (lossPause) {
      this.logPaperResult(currentCandle, paperResult, false, executionSymbol);
      await this.sendTradeAlerts(executionSymbol, paperResult.events, false);
      return;
    }
    if (this.options.pairCooldown && paperResult.events.some(event => event.type === "CLOSED" && event.netPnlUsdt < 0)) {
      pairPaused = await this.refreshPairCooldown(executionSymbol);
      if (pairPaused) demoCandidate = false;
    }
    const paperOpened = paperResult.events.some((event) => event.type === "OPENED");
    let demoApproved = approved && paperOpened;
    let entryAuthorization: Pick<DemoAdmission, "entryRevision" | "exposurePositions"> = {};
    if (this.options.demoExecutor && this.options.inspectDemoEntry) {
      demoApproved = false;
      if (demoCandidate && !this.demoExecutionBlocked && !(await this.options.persistence?.isPaused())) {
        const admission = await this.options.inspectDemoEntry(executionSymbol, exitRates.stopLossRate);
        demoApproved = admission.allowed;
        entryAuthorization = {
          ...(admission.entryRevision !== undefined ? { entryRevision: admission.entryRevision } : {}),
          ...(admission.exposurePositions ? { exposurePositions: admission.exposurePositions } : {}),
        };
        await this.recordOperationalEvent("DEMO_ENTRY_DECISION", admission.allowed ? "INFO" : "WARN", {
          symbol: executionSymbol, candleTimestamp: currentCandle.timestamp,
          approved: admission.allowed, stage: "portfolio_admission", reason: admission.reason ?? "demo_preflight_passed",
          ...(admission.exposure ? { exposure: admission.exposure } : {}),
        });
      }
    }
    if (!demoCandidate && this.options.inspectDemoEntry) {
      await this.recordOperationalEvent("DEMO_ENTRY_DECISION", "INFO", { symbol: executionSymbol,
        candleTimestamp: currentCandle.timestamp, approved: false,
        reason: marketBlock ?? (pairPaused && signal.action === "BUY" ? "pair_loss_cooldown" : regimeBlock) ?? (signal.action !== "BUY" ? `signal_${signal.action.toLowerCase()}` : "entry_filter_or_risk_circuit_breaker") });
    }
    if (demoApproved && this.options.demoExecutor) {
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
          await this.recordOperationalEvent("DEMO_ENTRY_DECISION", "INFO", {
            symbol: executionSymbol, candleTimestamp: currentCandle.timestamp,
            approved: false, reason: "trade_interval_limit_reached",
          });
        } else {
          await this.recordOperationalEvent("DEMO_ENTRY_ATTEMPT", "INFO", {
            symbol: executionSymbol, candleTimestamp: currentCandle.timestamp, paperOpened,
          });
          const demoResult = await this.options.demoExecutor.executeApprovedBuy({
            symbol: executionSymbol,
            candleTimestamp: currentCandle.timestamp,
            ...exitRates,
            ...entryAuthorization,
          });
          if (demoResult.status === "SKIPPED" && ["risk_size_unavailable", "risk_entry_changed", "demo_bot_budget_unavailable", "demo_book_unavailable", "demo_spread_exceeded", "demo_order_limits_unconfirmed"].includes(demoResult.reason)) {
            await this.recordOperationalEvent("DEMO_ENTRY_DECISION", "INFO", {
              symbol: executionSymbol, candleTimestamp: currentCandle.timestamp, approved: false, stage: "execution", reason: demoResult.reason, paperOpened,
            });
          } else {
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
            if (demoResult.status === "PLACED" && this.options.verifyFilledDemoBuy) {
              const protection = await this.options.verifyFilledDemoBuy({
                symbol: executionSymbol, orderId: demoResult.orderId, clientOrderId: demoResult.clientOrderId,
              });
              if (protection.status === "blocked") {
                this.demoExecutionBlocked = true;
                try { await this.options.persistence?.setPaused(true, "system:demo_execution_safety", protection.reason); }
                catch { console.error(JSON.stringify({ event: "demo_safety_pause_write_failed" })); }
              }
              await this.recordOperationalEvent("DEMO_ENTRY_PROTECTION", protection.status === "safe" ? "INFO" : "WARN", {
                symbol: executionSymbol, candleTimestamp: currentCandle.timestamp, clientOrderId: demoResult.clientOrderId,
                verified: protection.status === "safe",
                ...(protection.status === "blocked" ? { reason: protection.reason } : {}),
              });
            }
            if (demoResult.status !== "PLACED") {
              this.demoExecutionBlocked = true;
              try { await this.options.persistence?.setPaused(true, "system:demo_order_not_confirmed"); }
              catch { console.error(JSON.stringify({ event: "demo_safety_pause_write_failed" })); }
              console.error(JSON.stringify({ event: "demo_execution_blocked", reason: "paper_demo_entry_mismatch" }));
            }
            await this.recordOperationalEvent("DEMO_ENTRY_RESULT", demoResult.status === "PLACED" ? "INFO" : "WARN", {
              symbol: executionSymbol, candleTimestamp: currentCandle.timestamp, paperOpened, status: demoResult.status,
              clientOrderId: demoResult.clientOrderId,
              ...(demoResult.status === "SKIPPED"
                ? { reason: demoResult.reason }
                : { orderId: demoResult.orderId, orderStatus: demoResult.orderStatus, filled: demoResult.filled }),
            });
            console.log(
              JSON.stringify({
                event:
                  demoResult.status === "PLACED"
                    ? "okx_demo_order_submitted"
                    : demoResult.status === "SKIPPED" ? "okx_demo_order_skipped" : "okx_demo_order_unconfirmed",
                symbol: executionSymbol,
                result: demoResult,
              }),
            );
            await this.recordServiceStatus(
              "okx-demo",
              demoResult.status === "PENDING" ? "unhealthy" : "ok",
              demoResult.status === "PENDING" ? new Error(demoResult.reconciliationError ?? "OKX order was not confirmed") : undefined,
            );
          }
        }
      } catch (error) {
        this.demoExecutionBlocked = true;
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
            error: serializeOkxError(error),
          }),
        );
        const availabilityFailure = isOkxAvailabilityFailure(error);
        await this.recordOperationalEvent(availabilityFailure ? "OKX_ORDER_ERROR" : "OKX_ORDER_REJECTED", availabilityFailure ? "ERROR" : "WARN", {
          symbol: executionSymbol, candleTimestamp: currentCandle.timestamp, paperOpened,
          error: serializeOkxError(error),
        });
        if (availabilityFailure) {
          await this.recordServiceStatus("okx-demo", "unhealthy", error);
        } else {
          await this.recordServiceStatus("okx-demo", "ok");
        }
        try { await this.options.persistence?.setPaused(true, "system:demo_order_not_confirmed"); }
        catch { console.error(JSON.stringify({ event: "demo_safety_pause_write_failed" })); }
      }
    }

    if (approved && this.options.demoExecutor && !paperOpened && !this.options.inspectDemoEntry) {
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
    await this.sendTradeAlerts(executionSymbol, paperResult.events, false);
  }

  private async inspectBtcRegime(timestamp: number) {
    const latestClosed = Math.floor(Date.now() / REGIME_CANDLE_MS) * REGIME_CANDLE_MS - REGIME_CANDLE_MS;
    if (timestamp !== latestClosed) return "btc_regime_data_unavailable";
    try {
      const candles = await this.market.fetchClosedCandles("BTC/USDT", BTC_REGIME_HISTORY);
      return btcRegimeBlock(candles, timestamp, candles.findIndex(c => c.timestamp === timestamp));
    } catch {
      return "btc_regime_data_unavailable";
    }
  }

  private exportRiskState(): { consecutiveLosses: number; stopLossCooldownUntil: number } {
    return { consecutiveLosses: this.consecutiveLosses, stopLossCooldownUntil: this.stopLossCooldownUntil };
  }

  private applyLossControls(events: PaperCycleResult["events"], candleTimestamp: number): boolean {
    const limit = this.options.maxConsecutiveLosses ?? Number.POSITIVE_INFINITY;
    let crossed = false;
    for (const event of events) {
      if (event.type !== "CLOSED") continue;
      if (event.netPnlUsdt < 0) {
        this.consecutiveLosses += 1;
        crossed ||= this.consecutiveLosses === limit;
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
    return crossed;
  }

  private restoreRiskState(state: ReturnType<TradingBot["exportRiskState"]>): void {
    this.consecutiveLosses = state.consecutiveLosses;
    this.stopLossCooldownUntil = state.stopLossCooldownUntil;
  }

  private async persistPaperCycle(cycle: PersistedCycle, lossPause: boolean, controlRevision?: string): Promise<void> {
    await this.options.persistence?.recordCycle(lossPause ? { ...cycle, lossPause: controlRevision === undefined ? {} : { controlRevision } } : cycle);
    if (lossPause) this.observedPaused = true;
  }

  private async paperHistoryGap(trader: PaperTrader, symbol: string, cursor: number | undefined, candles: Candle[]): Promise<boolean> {
    if (!trader.hasOpenPosition || cursor === undefined) return false;
    let last = cursor;
    for (const candle of candles) {
      if (candle.timestamp !== last + 15 * 60_000) {
        if (this.reportedPaperGaps.get(symbol) !== last) {
          this.reportedPaperGaps.set(symbol, last);
          await this.recordOperationalEvent("PAPER_RECOVERY_BLOCKED", "WARN", {
            symbol, reason: "paper_candle_gap", lastProcessedCandle: last, nextAvailableCandle: candle.timestamp,
            entryTimestamp: trader.exportState().position?.entryTimestamp,
          });
        }
        return true;
      }
      last = candle.timestamp;
    }
    if (candles.length) this.reportedPaperGaps.delete(symbol);
    return false;
  }

  private async monitorOtherPaperPositions(selectedSymbol: string, controlRevision?: string): Promise<void> {
    if (!this.options.inspectDemoEntry && !this.options.paperTrader.configuration.riskSizing) return;
    for (const position of this.options.tradeManager?.activePositions ?? []) {
      if (position.symbol === selectedSymbol) continue;
      const trader = await this.getPaperTrader(position.symbol);
      const candles = await this.market.fetchClosedCandles(position.symbol, this.options.candleLimit);
      const last = this.lastProcessedCandleBySymbol.get(position.symbol) ?? position.openedAt;
      const unseen = candles.filter(c => c.timestamp > last);
      if (await this.paperHistoryGap(trader, position.symbol, last, unseen)) continue;
      for (const candle of unseen) {
        const before = trader.exportState();
        const index = candles.findIndex(c => c.timestamp === candle.timestamp);
        const signal = index >= 49 ? evaluateStrategy(candles.slice(0, index + 1), this.options.minimumSignalScore === undefined ? undefined : { minimumScore: this.options.minimumSignalScore }) : undefined;
        const riskBefore = this.exportRiskState();
        const result = trader.processCandle(candle, false, undefined, signal?.action === "SELL");
        trader.advanceManagedExit(candles.slice(0, index + 1));
        const lossPause = this.applyLossControls(result.events, candle.timestamp);
        try {
          await this.persistPaperCycle({ symbol: position.symbol, candle, replayed: true, paperResult: result, paperState: trader.exportState(), riskState: this.exportRiskState() }, lossPause, controlRevision);
        } catch (error) {
          trader.restoreState(before);
          this.restoreRiskState(riskBefore);
          throw error;
        }
        this.lastProcessedCandleBySymbol.set(position.symbol, candle.timestamp);
        if (result.events.some(e => e.type === "CLOSED")) {
          this.options.tradeManager?.recordExit(position.symbol);
          if (lossPause) return;
          break;
        }
      }
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

  private async refreshPairCooldown(symbol: string): Promise<boolean> {
    const cooldowns = await this.options.persistence!.activePairCooldowns!(Date.now(), this.options.pairCooldown!);
    if (this.lastScan) this.lastScan.cooldowns = cooldowns;
    return cooldowns.some(cooldown => cooldown.symbol === symbol);
  }

  private async scanSignals(currentCandles: Candle[], pausedPairs: Set<string>) {
    const timestamp = currentCandles.at(-1)!.timestamp;
    const provider = this.market.active;
    if (this.scanCache?.timestamp !== timestamp || this.scanCache.provider !== provider) {
      this.scanCache = { timestamp, provider, candles: new Map() };
    }
    const cache = this.scanCache;
    const requests = { discovery: 0, candles: 0 };
    if (!cache.discovered && this.options.dynamicUniverseSize && typeof this.market.selectSpotSymbols === "function") {
      try {
        requests.discovery++;
        cache.discovered = await this.market.selectSpotSymbols({
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
    const symbols = new Set([...configuredSymbols, ...this.activeUniverse, ...(cache.discovered ?? [])]);
    const candidates: Array<{ symbol: string; candles: Candle[] }> = [];
    for (const symbol of symbols) {
      if (pausedPairs.has(symbol)) continue;
      if (symbol === this.options.symbol) {
        candidates.push({ symbol, candles: currentCandles });
        continue;
      }
      try {
        let aligned = cache.candles.get(symbol);
        if (!aligned) {
          requests.candles++;
          const candles = await this.market.fetchClosedCandles(symbol, this.options.candleLimit + 5);
          const targetIndex = candles.findIndex(candle => candle.timestamp === timestamp);
          if (targetIndex < 49) continue;
          aligned = candles.slice(0, targetIndex + 1);
          if (this.market.active === provider) cache.candles.set(symbol, aligned);
        }
        candidates.push({ symbol, candles: aligned });
      } catch (error) {
        console.error(JSON.stringify({
          event: "signal_scan_failed",
          symbol,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    const blockedSymbols = new Set(this.options.inspectDemoEntry ? this.demoOccupiedSymbols : this.options.tradeManager?.activePositions.map(position => position.symbol));
    const key = JSON.stringify([candidates.map(candidate => candidate.symbol), [...blockedSymbols].sort()]);
    if (cache.rankingKey !== key || !cache.ranking || this.market.active !== provider) {
      cache.ranking = rankSignals(candidates, this.options.minimumSignalScore, blockedSymbols);
      cache.rankingKey = key;
    }
    const activeSymbols = await this.updateUniverse(cache.ranking, configuredSymbols, timestamp, universeSize, pausedPairs);
    const ranking = cache.ranking.filter(candidate => activeSymbols.has(candidate.symbol) && !pausedPairs.has(candidate.symbol));
    return { ranking, requests };
  }

  private async updateUniverse(
    ranked: RankedSignal[],
    configuredSymbols: string[],
    candleTimestamp: number,
    universeSize: number,
    pausedPairs: ReadonlySet<string>,
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
      (symbol) => !configured.has(symbol) && !pausedPairs.has(symbol) && !bySymbol.has(symbol),
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
      this.dailyStartEquityBySymbol.clear();
    }
    if (!this.dailyStartEquityBySymbol.has(symbol)) {
      this.dailyStartEquityBySymbol.set(symbol, await this.options.persistence?.getDailyStartEquity?.(symbol) ?? equity);
    }
  }

  private calculateVolatilityExitRates(candles: Candle[], referencePrice: number, trader = this.options.paperTrader): { stopLossRate: number; takeProfitRate: number; trailingStopRate: number } {
    if (this.options.exitPolicy) return { ...initialExitRates(candles, referencePrice, this.options.exitPolicy, { stopLossRate: this.options.fallbackStopLossRate ?? trader.stopLossRate, takeProfitRate: this.options.fallbackTakeProfitRate ?? .02 }), trailingStopRate: 0 };
    const atr = averageTrueRange(candles, this.options.atrPeriod ?? 14);
    if (atr <= 0) {
      return {
        stopLossRate: this.options.fallbackStopLossRate ?? trader.stopLossRate,
        takeProfitRate: this.options.fallbackTakeProfitRate ?? 0.02,
        trailingStopRate: this.options.fallbackStopLossRate ?? trader.stopLossRate,
      };
    }
    const volatilityRate = atr > 0 ? atr / referencePrice : trader.stopLossRate;
    const stopLossRate = Math.min(this.options.atrMaxStopRate ?? 0.03, Math.max(this.options.atrMinStopRate ?? 0.005, volatilityRate * (this.options.atrStopMultiplier ?? 1.5)));
    const takeProfitRate = Math.min(0.5, Math.max(stopLossRate, volatilityRate * (this.options.atrTakeProfitMultiplier ?? 3)));
    return { stopLossRate, takeProfitRate, trailingStopRate: stopLossRate };
  }

  private riskBlockReason(exitRates: { stopLossRate: number; takeProfitRate: number }, trader: PaperTrader): string | undefined {
    const traderState = trader.exportState();
    if (traderState.position) return "position_already_open";
    const balance = Math.max(traderState.peakEquityUsdt, traderState.cashUsdt);
    const tradeSize = trader.tradeSizeUsdt;
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
    symbol: string,
    events: PaperCycleResult["events"],
    replayed: boolean,
  ): Promise<void> {
    if (!this.options.emailAlerts) return;
    for (const trade of events) {
      try {
        if (trade.type === "OPENED") {
          await this.options.emailAlerts.sendOpened(symbol, trade);
        } else {
          await this.options.emailAlerts.sendClosed(symbol, trade);
        }
        console.log(JSON.stringify({
          event: "trade_email_alert_sent",
          symbol,
          tradeType: trade.type,
          replayed,
        }));
      } catch (error) {
        console.error(JSON.stringify({
          event: "trade_email_alert_failed",
          symbol,
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

function isOkxAvailabilityFailure(error: unknown): boolean {
  const typed = error as { okxFailureKind?: string; name?: string } | null;
  if (typed?.okxFailureKind) return typed.okxFailureKind === "availability";
  return ["NetworkError", "ExchangeNotAvailable", "RequestTimeout", "DDoSProtection", "AuthenticationError", "OnMaintenance"].includes(typed?.name ?? "");
}

function serializeOkxError(error: unknown): Record<string, unknown> {
  const typed = error as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown; response?: unknown; okxFailureKind?: unknown; okxDetails?: unknown };
  return {
    name: typed?.name ?? "Error",
    message: typed?.message ?? String(error),
    code: typed?.code,
    response: typed?.response,
    failureKind: typed?.okxFailureKind,
    details: typed?.okxDetails,
    stack: typed?.stack,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
