import { netActivationPrice, type ResearchTrailing } from "./research-trailing.js";
import { tradeProfitConcentration } from "./backtest-performance.js";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { btcRegimeBlock, REGIME_CANDLE_MS } from "./btc-regime.js";
import { quantizeQuantityDown } from "./decimal-quantity.js";
import { initialExitRates } from "./exit-policy.js";
import { pairCooldownUntil } from "./pair-cooldown.js";
import { PaperTrader, type PaperTradeClosed } from "./paper-trader.js";
import { evaluateStrategy } from "./strategy.js";
import { assertComparisonCandidatesAndScenarios, compareDemoStrategies, comparisonSchema, comparisonSlippage, scenarioCosts, type ComparisonOptions } from "./strategy-comparison.js";
import { TREND_STRATEGY_ID } from "./strategy-id.js";
import { diagnoseClosedTrades, paperDiagnosticTrade, type DiagnosticTrade, type EntryDiagnosticContext } from "./strategy-diagnostics.js";
import { assertValidHistoricalCandles } from "./strategy-validation.js";
import { requiredWalkForwardWarmup } from "./walk-forward.js";
import type { Candle } from "./types.js";

type Parameters = ComparisonOptions["baseline"];
type Scenario = ComparisonOptions["scenarios"][number];
export type PortfolioInstrument = { symbol: string; candles: Candle[]; constraints: ComparisonOptions["constraints"]; quoteVolumesUsdt?: number[] };
type Instrument = PortfolioInstrument;
type Dataset = { candles: Candle[]; btcCandles?: Candle[]; options: ComparisonOptions };
type Rejection = "cash" | "positions" | "totalExposure" | "altExposure" | "liquidity" | "minimum" | "regime" | "cooldown";

export const portfolioLimitsSchema = z.object({
  maxConcurrentPositions: z.number().int().min(1).max(50),
  maxExposureRate: z.number().gt(0).max(1),
  maxAltExposureRate: z.number().gt(0).max(1),
}).strict();
type PortfolioLimits = z.infer<typeof portfolioLimitsSchema>;

function resolvePortfolio(datasets: Dataset[], rawLimits: PortfolioLimits) {
  const limits = portfolioLimitsSchema.parse(rawLimits);
  const inputs = datasets.map(dataset => ({ ...dataset, options: comparisonSchema.parse(dataset.options) }));
  const reference = inputs[0];
  if (!reference || inputs.length < 2) throw new Error("Portfolio comparison requires at least two symbols");
  const common = (options: ComparisonOptions) => {
    const { symbol, dataSource, constraints, ...rest } = options;
    return rest;
  };
  const instruments = inputs.map(({ options, candles }) => ({ symbol: options.symbol, constraints: options.constraints, candles }));
  if (inputs.some(input => !isDeepStrictEqual(common(input.options), common(reference.options)))) throw new Error("Portfolio comparison requires the same options for every symbol");
  const clock = reference.candles;
  for (const instrument of instruments) {
    if (instrument.candles.length !== clock.length || instrument.candles.some((c, i) => c.timestamp !== clock[i]!.timestamp)) {
      throw new Error(`Portfolio comparison requires aligned series: ${instrument.symbol}`);
    }
  }
  if (new Set(instruments.map(i => i.symbol)).size !== instruments.length) throw new Error("Duplicate portfolio symbols");

  const { options } = reference;
  const variants = [{ name: "baseline", parameters: options.baseline }, ...options.alternatives];
  if (variants.some(variant => variant.parameters.riskSizing)) throw new Error("Portfolio comparison requires fixed trade ceilings");
  const btc = instruments.find(i => i.symbol === "BTC/USDT")?.candles;
  const usesBtc = variants.some(variant => variant.parameters.btcRegimeFilter);
  if (usesBtc && !btc) throw new Error("Include BTC/USDT among the datasets to compare the BTC regime filter");
  const btcHash = usesBtc ? hash(btc!) : undefined;
  if (usesBtc && inputs.some(input => input.btcCandles && hash(input.btcCandles) !== btcHash)) {
    throw new Error("Inconsistent BTC regime reference series");
  }
  return { inputs, instruments, options, limits, variants, btc, usesBtc, clock };
}

function portfolioScores(instruments: Instrument[], parameters: Parameters, start: number) {
  return new Map(instruments.map(({ symbol, candles }) => [symbol, candles.map((_, index) => {
    if (index < start) return undefined;
    const signal = evaluateStrategy(candles.slice(0, index + 1), {
      minimumScore: parameters.minimumSignalScore, maxBuyRsi: parameters.maxBuyRsi ?? 70,
    });
    return signal.action === "BUY" ? signal.score : undefined;
  })]));
}

export function comparePortfolio(datasets: Dataset[], rawLimits: PortfolioLimits) {
  const { inputs, instruments, options, limits, variants, btc, usesBtc, clock } = resolvePortfolio(datasets, rawLimits);
  const perSymbol = inputs.map(input => compareDemoStrategies(input.candles, input.options, usesBtc ? btc : undefined));
  const signals = new Map<string, Map<string, Array<number | undefined>>>();
  const evaluationStart = options.trainCandles;

  return {
    status: "simulation_only",
    limits,
    evaluation: { startUtc: new Date(clock[evaluationStart]!.timestamp).toISOString(), endExclusiveUtc: new Date(clock.at(-1)!.timestamp + REGIME_CANDLE_MS).toISOString() },
    perSymbol,
    results: options.scenarios.map(scenario => ({
      scenario,
      variants: variants.map(({ name, parameters }) => {
        const key = JSON.stringify([parameters.minimumSignalScore, parameters.maxBuyRsi ?? 70]);
        let scores = signals.get(key);
        if (!scores) {
          scores = portfolioScores(instruments, parameters, evaluationStart);
          signals.set(key, scores);
        }
        return {
          name, parameters,
          ...runPortfolioScenario(instruments, scores, evaluationStart, parameters, scenario, limits, options.initialBalanceUsdt, options.tradeSizeUsdt, btc),
        };
      }),
    })),
    limitations: [
      "The portfolio is continuous. Independent walk-forward windows are in perSymbol and each starts with fresh capital.",
      "Entries use a fixed universe and score ordering, with symbol as the tie-breaker. Exchange fills, live spread, account fees and watchlist rotation are not reproduced.",
      "Exposure limits measure entry notionals against prior closing equity. Positions and cash from exits in the same candle are unavailable for new entries at its open.",
      "Portfolio limits do not reproduce the global daily guard, order-rate controls or per-strategy budgets.",
    ],
  };
}

const TEN_DAYS = 10 * 96;

export function comparePortfolioHoldout(datasets: Dataset[], rawLimits: PortfolioLimits) {
  const { instruments, options, limits, variants, btc, clock } = resolvePortfolio(datasets, rawLimits);
  assertComparisonCandidatesAndScenarios(options);
  const start = options.trainCandles;
  const holdoutStart = start + TEN_DAYS;
  const split = holdoutStart + TEN_DAYS;
  if (clock.length !== start + 3 * TEN_DAYS || clock[0]!.timestamp % REGIME_CANDLE_MS !== 0) {
    throw new Error("Holdout requires exactly 30 contiguous evaluation days plus warmup");
  }
  for (const instrument of instruments) assertValidHistoricalCandles(instrument.candles);
  const minimumWarmup = Math.max(...variants.map(({ parameters }) =>
    requiredWalkForwardWarmup({ qualityFilters: true }, [parameters])));
  if (start < minimumWarmup) throw new Error(`Holdout requires at least ${minimumWarmup} warmup candles`);

  const run = (series: Instrument[], from: number, parameters: Parameters, scenario: Scenario, btcSeries?: Candle[], boundary?: number) =>
    runPortfolioScenario(series, portfolioScores(series, parameters, from), from, parameters, scenario,
      limits, options.initialBalanceUsdt, options.tradeSizeUsdt, btcSeries, boundary);

  // Only the calibration prefix is passed to strategy selection.
  const calibration = instruments.map(instrument => ({ ...instrument, candles: instrument.candles.slice(0, holdoutStart) }));
  const calibrationBtc = btc?.slice(0, holdoutStart);
  const standard = options.scenarios[0]!;
  const training = variants.map(variant => ({
    ...variant, result: run(calibration, start, variant.parameters, standard, calibrationBtc),
  }));
  const winner = [...training].sort((a, b) =>
    b.result.netReturnUsdt - a.result.netReturnUsdt || a.result.maxDrawdownUsdt - b.result.maxDrawdownUsdt)[0]!;
  const results = options.scenarios.map(scenario => {
    const result = run(instruments, holdoutStart, winner.parameters, scenario, btc, split);
    return { scenario, result, bothBlocksPositive: result.blocks!.every(block => block.netReturnUsdt > 0) };
  });
  const utc = (index: number) => new Date(clock[0]!.timestamp + index * REGIME_CANDLE_MS).toISOString();
  return {
    status: "simulation_only",
    assets: instruments.map(({ symbol, constraints, candles }) => ({
      symbol, constraints, candleCount: candles.length, sha256: hash(candles),
    })),
    limits, initialBalanceUsdt: options.initialBalanceUsdt, tradeSizeUsdt: options.tradeSizeUsdt,
    calibration: { startUtc: utc(start), endExclusiveUtc: utc(holdoutStart), scenario: standard, candidates: training },
    selected: { name: winner.name, parameters: winner.parameters },
    results,
    methodology: [
      "Calibrate on D1-D10 using only the standard scenario. Rank by net marked P&L, then lower drawdown in USDT, then manifest order.",
      "Start a fresh wallet on D11. Carry equity, positions and cooldowns from D20 into D21 with frozen parameters.",
      "Block return uses marked equity. Count each closed trade and its realized P&L in the block containing its exit.",
      "Historical simulation uses assumed costs and liquidity. Both holdout blocks positive is a descriptive screen.",
    ],
  };
}

export function runPortfolioScenario(
  instruments: Instrument[],
  scores: ReadonlyMap<string, ReadonlyArray<number | undefined>>,
  start: number,
  parameters: Parameters,
  scenario: Scenario,
  limits: PortfolioLimits,
  initialBalance: number,
  tradeSize: number,
  btc?: Candle[],
  split?: number,
  signalCandleLimit?: number,
  researchTrailing?: ResearchTrailing,
) {
  if (split !== undefined && (!Number.isInteger(split) || split <= start || split >= instruments[0]!.candles.length)) {
    throw new Error("Portfolio split must be inside the replay window");
  }

  const researchExitDiagnostics = { opened: 0, fixedTargetBelowNetActivation: 0, activatedPositions: 0, stopUpdates: 0, closedBeforeActivation: 0, closedAfterActivation: 0, takeProfitBeforeActivation: 0 };
  const entryContexts = new Map<string, EntryDiagnosticContext>();
  const closedTradeLedger: DiagnosticTrade[] = [];
  const assets = instruments.map(instrument => {
    const costs = scenarioCosts(scenario, instrument.symbol);
    const slippageRate = comparisonSlippage(costs);
    return {
    ...instrument, costs, slippageRate,
    trader: new PaperTrader({
      stopLossRate: parameters.stopLossRate, takeProfitRate: parameters.takeProfitRate,
      ...(parameters.exitPolicy ? { exitPolicy: parameters.exitPolicy } : {}),
      ...(researchTrailing ? { researchTrailing } : {}),
      strategyId: TREND_STRATEGY_ID, initialBalanceUsdt: initialBalance,
      tradeSizeUsdt: tradeSize, feeRate: costs.feeRate, entryFeeCurrency: costs.entryFeeCurrency, slippageRate, executionConstraints: instrument.constraints,
    }),
    alt: instrument.symbol !== "BTC/USDT",
    trades: [] as PaperTradeClosed[],
    rejected: {} as Partial<Record<Rejection, number>>,
    cooldownUntil: undefined as number | undefined,
  }; });
  let cash = initialBalance;
  let equity = cash;
  let peak = cash;
  let maxDrawdownPercent = 0;
  let maxDrawdownUsdt = 0;
  let peakConcurrentPositions = 0;
  let peakExposureRate = 0;
  let peakAltExposureRate = 0;
  const marks: number[] = [];
  const delay = Math.max(1, parameters.executionDelayCandles);
  const reject = (asset: typeof assets[number], reason: Rejection) => { asset.rejected[reason] = (asset.rejected[reason] ?? 0) + 1; };
  const regimeBlocked = (index: number) => parameters.btcRegimeFilter &&
    (!btc || btcRegimeBlock(btc, instruments[0]!.candles[index]!.timestamp, index) !== undefined);
  for (let index = start; index < instruments[0]!.candles.length; index++) {
    const timestamp = instruments[0]!.candles[index]!.timestamp;
    let available = cash;
    let count = 0, exposure = 0, altExposure = 0;
    const occupied = new Set<string>();
    for (const asset of assets) {
      const position = asset.trader.exportState().position;
      if (!position) continue;
      occupied.add(asset.symbol);
      count++;
      exposure += position.entryNotional;
      if (asset.alt) altExposure += position.entryNotional;
    }
    const entryIndex = index - delay;
    const candidates = entryIndex < start ? [] : assets
      .flatMap(asset => {
        const score = scores.get(asset.symbol)?.[entryIndex];
        return score === undefined || occupied.has(asset.symbol) ? [] : [{ asset, score }];
      })
      .sort((a, b) => b.score - a.score || a.asset.symbol.localeCompare(b.asset.symbol, "en"));
    const entries = new Set<string>();

    for (const { asset } of candidates) {
      const candle = asset.candles[index]!;
      const previous = asset.candles[index - 1]!;
      if (regimeBlocked(entryIndex) || (delay > 1 && regimeBlocked(index - 1))) { reject(asset, "regime"); continue; }
      if (asset.cooldownUntil !== undefined && timestamp < asset.cooldownUntil) { reject(asset, "cooldown"); continue; }
      if (tradeSize > Math.min(scenario.assumedDepthUsdt, (asset.quoteVolumesUsdt?.[index - 1] ?? previous.volume * previous.close) * scenario.maxParticipationRate)) {
        reject(asset, "liquidity"); continue;
      }
      const { quantity, notional } = quantizeQuantityDown(tradeSize, candle.open * (1 + asset.slippageRate), asset.constraints.quantityStep);
      if (quantity <= 0 || quantity < asset.constraints.minimumQuantity || notional < asset.constraints.minimumNotionalUsdt) {
        reject(asset, "minimum"); continue;
      }
      if (asset.costs.entryFeeCurrency === "base") {
        const sellable = quantizeQuantityDown(quantity * (1 - asset.costs.feeRate) * candle.open * (1 + asset.slippageRate), candle.open * (1 + asset.slippageRate), asset.constraints.quantityStep);
        if (sellable.quantity < asset.constraints.minimumQuantity || sellable.notional < asset.constraints.minimumNotionalUsdt) { reject(asset, "minimum"); continue; }
      }
      const cost = notional + (asset.costs.entryFeeCurrency === "base" ? 0 : notional * asset.costs.feeRate);
      if (cost > available) { reject(asset, "cash"); continue; }
      if (count >= limits.maxConcurrentPositions) { reject(asset, "positions"); continue; }
      if (exposure + notional > equity * limits.maxExposureRate) { reject(asset, "totalExposure"); continue; }
      if (asset.alt && altExposure + notional > equity * limits.maxAltExposureRate) { reject(asset, "altExposure"); continue; }

      // All entries are planned at the open, before any intrabar exits are known.
      entries.add(asset.symbol);
      available -= cost;
      count++;
      exposure += notional;
      if (asset.alt) altExposure += notional;
    }
    peakConcurrentPositions = Math.max(peakConcurrentPositions, count);
    peakExposureRate = Math.max(peakExposureRate, exposure / equity);
    peakAltExposureRate = Math.max(peakAltExposureRate, altExposure / equity);
    let marketValue = 0;
    for (const asset of assets) {
      const candle = asset.candles[index]!;
      const approved = entries.has(asset.symbol);
      if (!approved && !occupied.has(asset.symbol)) continue;
      const prior = parameters.exitPolicy ? asset.candles.slice(scenario.symbolCosts && signalCandleLimit ? Math.max(0, index - signalCandleLimit) : 0, index) : undefined;
      const entryHistory = scenario.symbolCosts && approved ? asset.candles.slice(signalCandleLimit ? Math.max(0, entryIndex + 1 - signalCandleLimit) : 0, entryIndex + 1) : prior;
      const rates = approved && entryHistory && parameters.exitPolicy ? {
        ...initialExitRates(entryHistory, scenario.symbolCosts ? entryHistory.at(-1)!.close : candle.open, parameters.exitPolicy, parameters),
        ...(scenario.symbolCosts ? { referencePrice: candle.open * (1 + asset.costs.spreadRate / 2) } : {}),
      } : undefined;
      // PaperTrader simulates the instrument's fill. Only the shared wallet above admits entries.
      if (approved) asset.trader.restoreState({ ...asset.trader.exportState(), cashUsdt: tradeSize * 2 });
      const positionBefore = researchTrailing ? asset.trader.exportState().position : null;
      const { events } = asset.trader.processCandle(candle, approved, rates, false, candle.open);
      if (approved && events[0]?.type !== "OPENED") throw new Error(`Accepted portfolio entry did not open: ${asset.symbol}`);
      for (const event of events) {
        if (event.type === "OPENED") {
          if (researchTrailing) {
            researchExitDiagnostics.opened++;
            const costUsdt = event.notionalUsdt + (event.entryFeeCurrency === "base" ? 0 : event.feeUsdt);
            if (event.takeProfitPrice < netActivationPrice(costUsdt,event.quantity,asset.costs.feeRate,asset.slippageRate,researchTrailing.netActivationRate)) researchExitDiagnostics.fixedTargetBelowNetActivation++;
          }
          cash -= event.notionalUsdt + (event.entryFeeCurrency === "base" ? 0 : event.feeUsdt);
          const history = asset.candles.slice(signalCandleLimit ? Math.max(0, entryIndex + 1 - signalCandleLimit) : 0, entryIndex + 1);
          const signal = history.length >= 50 ? evaluateStrategy(history, { minimumScore: parameters.minimumSignalScore, maxBuyRsi: parameters.maxBuyRsi ?? 70 }) : undefined;
          entryContexts.set(asset.symbol, {
            decisionTimestamp: asset.candles[entryIndex]!.timestamp,
            ...(scores.get(asset.symbol)?.[entryIndex] !== undefined ? { score: scores.get(asset.symbol)![entryIndex]! } : {}),
            ...(signal ? { rsi14: signal.rsi14 } : {}),
            btcState: btc ? btcRegimeBlock(btc, asset.candles[entryIndex]!.timestamp, entryIndex) ?? "allowed" : "unknown",
          });
        } else {
          if (researchTrailing) {
            if (positionBefore?.researchTrailingActivated) researchExitDiagnostics.closedAfterActivation++;
            else { researchExitDiagnostics.closedBeforeActivation++; if (event.reason === "TAKE_PROFIT") researchExitDiagnostics.takeProfitBeforeActivation++; }
          }
          cash += event.grossProceedsUsdt - event.grossProceedsUsdt * asset.costs.feeRate;
          asset.trades.push(event);
          closedTradeLedger.push(paperDiagnosticTrade(asset.symbol, event, entryContexts.get(asset.symbol)));
          entryContexts.delete(asset.symbol);
          if (parameters.pairCooldown) {
            const recent = asset.trades.slice(-parameters.pairCooldown.minLosses).reverse()
              .map(trade => ({ closedAt: trade.exitTimestamp + REGIME_CANDLE_MS, netPnlUsdt: trade.netPnlUsdt }));
            asset.cooldownUntil = pairCooldownUntil(recent, timestamp + REGIME_CANDLE_MS, parameters.pairCooldown);
          }
        }
      }
      const beforeAdvance = researchTrailing ? asset.trader.exportState().position : null;
      if (prior) asset.trader.advanceManagedExit([...prior, candle]);
      if (researchTrailing && beforeAdvance) {
        const after = asset.trader.exportState().position!;
        if (!beforeAdvance.researchTrailingActivated && after.researchTrailingActivated) researchExitDiagnostics.activatedPositions++;
        if (after.stopLossPrice > beforeAdvance.stopLossPrice) researchExitDiagnostics.stopUpdates++;
      }
      marketValue += (asset.trader.exportState().position?.quantity ?? 0) * candle.close * (1 - asset.costs.feeRate);
    }
    equity = cash + marketValue;
    if (split !== undefined) marks.push(equity);
    peak = Math.max(equity, peak);
    maxDrawdownUsdt = Math.max(maxDrawdownUsdt, peak - equity);
    maxDrawdownPercent = Math.max(maxDrawdownPercent, (peak - equity) / peak * 100);
  }

  const perSymbol = assets.map(asset => {
    const state = asset.trader.exportState();
    const open = state.position;
    return {
      symbol: asset.symbol,
      ...(scenario.symbolCosts ? { executionCosts: asset.costs } : {}),
      ...tradeMetrics(asset.trades),
      rejected: asset.rejected,
      feesUsdt: state.totalFeesUsdt,
      openPosition: open ? { entryTimestamp: open.entryTimestamp, quantity: open.quantity, entryNotional: open.entryNotional } : null,
    };
  });
  const trades = assets.flatMap(asset => asset.trades);
  const blocks = split === undefined ? undefined : ([[start, split], [split, instruments[0]!.candles.length]] as const).map(([from, to]) => {
    const clock = instruments[0]!.candles;
    const startAt = clock[from]!.timestamp;
    const endAt = clock[to - 1]!.timestamp + REGIME_CANDLE_MS;
    const startingEquity = marks[from - start - 1] ?? initialBalance;
    const endingEquity = marks[to - start - 1]!;
    let blockPeak = startingEquity, drawdownUsdt = 0, drawdownPercent = 0;
    for (const mark of marks.slice(from - start, to - start)) {
      blockPeak = Math.max(blockPeak, mark);
      drawdownUsdt = Math.max(drawdownUsdt, blockPeak - mark);
      drawdownPercent = Math.max(drawdownPercent, (blockPeak - mark) / blockPeak * 100);
    }
    const closed = trades.filter(trade => trade.exitTimestamp >= startAt && trade.exitTimestamp < endAt);
    const netReturnUsdt = endingEquity - startingEquity;
    return {
      startUtc: new Date(startAt).toISOString(), endExclusiveUtc: new Date(endAt).toISOString(),
      startingEquityUsdt: startingEquity, endingEquityUsdt: endingEquity, netReturnUsdt,
      maxDrawdownUsdt: drawdownUsdt, maxDrawdownPercent: drawdownPercent,
      recoveryFactor: drawdownUsdt > 0 ? netReturnUsdt / drawdownUsdt : null,
      ...tradeMetrics(closed),
      perSymbol: assets.map(asset => ({
        symbol: asset.symbol, ...tradeMetrics(asset.trades.filter(trade => trade.exitTimestamp >= startAt && trade.exitTimestamp < endAt)),
      })),
    };
  });
  return {
    ...tradeMetrics(trades),
    closedTradeLedger,
    ...(researchTrailing ? { researchExitDiagnostics } : {}),
    diagnostics: diagnoseClosedTrades(closedTradeLedger),
    ...(blocks ? { blocks } : {}),
    finalEquityUsdt: equity, netReturnUsdt: equity - initialBalance, netReturnPercent: (equity / initialBalance - 1) * 100,
    maxDrawdownPercent, maxDrawdownUsdt, recoveryFactor: maxDrawdownUsdt > 0 ? (equity - initialBalance) / maxDrawdownUsdt : null,
    cashUsdt: cash, peakConcurrentPositions, peakExposureRate, peakAltExposureRate,
    feesUsdt: perSymbol.reduce((sum, asset) => sum + asset.feesUsdt, 0),
    openPositions: perSymbol.filter(asset => asset.openPosition).length,
    perSymbol,
  };
}

function tradeMetrics(trades: PaperTradeClosed[]) {
  const profit = trades.reduce((sum, trade) => sum + Math.max(0, trade.netPnlUsdt), 0);
  const loss = trades.reduce((sum, trade) => sum + Math.max(0, -trade.netPnlUsdt), 0);
  return {
    ...tradeProfitConcentration(trades.map(trade => trade.netPnlUsdt), profit, profit - loss),
    closedTrades: trades.length,
    realizedPnlUsdt: profit - loss,
    profitFactor: loss > 0 ? profit / loss : null,
    winRatePercent: trades.length ? trades.filter(trade => trade.netPnlUsdt > 0).length / trades.length * 100 : null,
    expectancyUsdt: trades.length ? (profit - loss) / trades.length : null,
  };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
