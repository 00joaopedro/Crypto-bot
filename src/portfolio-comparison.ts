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
import { compareDemoStrategies, comparisonSchema, comparisonSlippage, type ComparisonOptions } from "./strategy-comparison.js";
import { TREND_STRATEGY_ID } from "./strategy-id.js";
import type { Candle } from "./types.js";

type Parameters = ComparisonOptions["baseline"];
type Scenario = ComparisonOptions["scenarios"][number];
type Instrument = { symbol: string; candles: Candle[]; constraints: ComparisonOptions["constraints"] };
type Dataset = { candles: Candle[]; btcCandles?: Candle[]; options: ComparisonOptions };
type Rejection = "cash" | "positions" | "totalExposure" | "altExposure" | "liquidity" | "minimum" | "regime" | "cooldown";

export const portfolioLimitsSchema = z.object({
  maxConcurrentPositions: z.number().int().min(1).max(50),
  maxExposureRate: z.number().gt(0).max(1),
  maxAltExposureRate: z.number().gt(0).max(1),
}).strict();
type PortfolioLimits = z.infer<typeof portfolioLimitsSchema>;

export function comparePortfolio(datasets: Dataset[], rawLimits: PortfolioLimits) {
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
          scores = new Map(instruments.map(({ symbol, candles }) => [symbol, candles.map((_, index) => {
            if (index < evaluationStart) return undefined;
            const signal = evaluateStrategy(candles.slice(0, index + 1), { minimumScore: parameters.minimumSignalScore, maxBuyRsi: parameters.maxBuyRsi ?? 70 });
            return signal.action === "BUY" ? signal.score : undefined;
          })]));
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
) {
  const slippageRate = comparisonSlippage(scenario);
  const feeRate = scenario.feeRate;
  const assets = instruments.map(instrument => ({
    ...instrument,
    trader: new PaperTrader({
      stopLossRate: parameters.stopLossRate, takeProfitRate: parameters.takeProfitRate,
      ...(parameters.exitPolicy ? { exitPolicy: parameters.exitPolicy } : {}),
      strategyId: TREND_STRATEGY_ID, initialBalanceUsdt: initialBalance,
      tradeSizeUsdt: tradeSize, feeRate, slippageRate, executionConstraints: instrument.constraints,
    }),
    alt: instrument.symbol !== "BTC/USDT",
    trades: [] as PaperTradeClosed[],
    rejected: {} as Partial<Record<Rejection, number>>,
    cooldownUntil: undefined as number | undefined,
  }));
  let cash = initialBalance;
  let equity = cash;
  let peak = cash;
  let maxDrawdownPercent = 0;
  let maxDrawdownUsdt = 0;
  let peakConcurrentPositions = 0;
  let peakExposureRate = 0;
  let peakAltExposureRate = 0;
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
      if (tradeSize > Math.min(scenario.assumedDepthUsdt, previous.volume * previous.close * scenario.maxParticipationRate)) {
        reject(asset, "liquidity"); continue;
      }
      const { quantity, notional } = quantizeQuantityDown(tradeSize, candle.open * (1 + slippageRate), asset.constraints.quantityStep);
      if (quantity <= 0 || quantity < asset.constraints.minimumQuantity || notional < asset.constraints.minimumNotionalUsdt) {
        reject(asset, "minimum"); continue;
      }
      const cost = notional + notional * feeRate;
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
      const prior = parameters.exitPolicy ? asset.candles.slice(0, index) : undefined;
      const rates = approved && prior && parameters.exitPolicy ? initialExitRates(prior, candle.open, parameters.exitPolicy, parameters) : undefined;
      // PaperTrader simulates the instrument's fill. Only the shared wallet above admits entries.
      if (approved) asset.trader.restoreState({ ...asset.trader.exportState(), cashUsdt: tradeSize * 2 });
      const { events } = asset.trader.processCandle(candle, approved, rates, false, candle.open);
      if (approved && events[0]?.type !== "OPENED") throw new Error(`Accepted portfolio entry did not open: ${asset.symbol}`);
      for (const event of events) {
        if (event.type === "OPENED") {
          cash -= event.notionalUsdt + event.feeUsdt;
        } else {
          cash += event.grossProceedsUsdt - event.grossProceedsUsdt * feeRate;
          asset.trades.push(event);
          if (parameters.pairCooldown) {
            const recent = asset.trades.slice(-parameters.pairCooldown.minLosses).reverse()
              .map(trade => ({ closedAt: trade.exitTimestamp + REGIME_CANDLE_MS, netPnlUsdt: trade.netPnlUsdt }));
            asset.cooldownUntil = pairCooldownUntil(recent, timestamp + REGIME_CANDLE_MS, parameters.pairCooldown);
          }
        }
      }
      if (prior) asset.trader.advanceManagedExit([...prior, candle]);
      marketValue += (asset.trader.exportState().position?.quantity ?? 0) * candle.close * (1 - feeRate);
    }
    equity = cash + marketValue;
    peak = Math.max(equity, peak);
    maxDrawdownUsdt = Math.max(maxDrawdownUsdt, peak - equity);
    maxDrawdownPercent = Math.max(maxDrawdownPercent, (peak - equity) / peak * 100);
  }

  const perSymbol = assets.map(asset => {
    const state = asset.trader.exportState();
    const open = state.position;
    return {
      symbol: asset.symbol,
      ...tradeMetrics(asset.trades),
      rejected: asset.rejected,
      feesUsdt: state.totalFeesUsdt,
      openPosition: open ? { entryTimestamp: open.entryTimestamp, quantity: open.quantity, entryNotional: open.entryNotional } : null,
    };
  });
  return {
    ...tradeMetrics(assets.flatMap(asset => asset.trades)),
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
