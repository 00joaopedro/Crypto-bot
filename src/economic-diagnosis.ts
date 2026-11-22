import { z } from "zod";
import { diagnoseClosedTrades, diagnosticTradeSchema, type DiagnosticTrade } from "./strategy-diagnostics.js";
import { comparisonSlippage, scenarioCosts, type ComparisonOptions } from "./strategy-comparison.js";
import { averageTrueRange, emaSeries } from "./indicators.js";
import { assertValidHistoricalCandles } from "./strategy-validation.js";
import { REGIME_CANDLE_MS } from "./btc-regime.js";
import type { UniverseDataset } from "./universe-comparison.js";
const horizons = [1, 4, 8] as const;
const mean = (values: number[]) => values.length ? values.reduce((a,b) => a+b,0) / values.length : null;
const distribution = (values: number[]) => {
  const sorted = [...values].sort((a,b) => a-b);
  return { samples: sorted.length, mean: mean(sorted), median: sorted.length ? sorted[Math.floor((sorted.length-1)/2)]! : null };
};

/** Ex-post description only. Never passed to entry selection or live execution. */
export function diagnoseEntryEconomics(rawTrades: unknown, datasets: UniverseDataset[], scenario: ComparisonOptions["scenarios"][number], candleLimit: number) {
  const trades = z.array(diagnosticTradeSchema).parse(rawTrades);
  if (!Number.isInteger(candleLimit) || candleLimit < 84) throw new Error("Runtime candle window required");
  const instruments = new Map(datasets.map(d => [d.symbol,d]));
  if (instruments.size !== datasets.length) throw new Error("Duplicate diagnostic instruments");
  for (const d of datasets) assertValidHistoricalCandles(d.candles);
  const clocks = new Map(datasets.map(d => [d.symbol, new Map(d.candles.map((c,i) => [c.timestamp,i]))]));
  const seen = new Set<string>();
  const rows = trades.map(trade => {
    const key = `${trade.symbol}:${trade.entryTimestamp}:${trade.exitTimestamp}`;
    if (seen.has(key)) throw new Error("Duplicate diagnostic trade"); seen.add(key);
    const data = instruments.get(trade.symbol), clock = clocks.get(trade.symbol);
    const entry = clock?.get(trade.entryTimestamp), exit = clock?.get(trade.exitTimestamp);
    if (!data || entry === undefined || exit === undefined) throw new Error("Trade clock does not match frozen candles");
    const costs = scenarioCosts(scenario, trade.symbol), effective = comparisonSlippage(costs);
    // Entry slippage is already inside entryPrice: do not debit it a second time.
    const cashBasis = trade.entryPrice * trade.quantity * (costs.entryFeeCurrency === "base" ? 1 / (1-costs.feeRate) : 1+costs.feeRate);
    const breakEvenMarketMoveRate = cashBasis / (trade.quantity * (1-costs.feeRate) * (1-effective) * trade.entryPrice) - 1;
    const projectedNet = trade.exitPrice * trade.quantity * (1-costs.feeRate) - cashBasis;
    if (Math.abs(projectedNet-trade.netPnlUsdt) > 1e-8*Math.max(1,cashBasis)) throw new Error("Trade fees differ from scenario costs");
    const decision = trade.entryContext ? clock!.get(trade.entryContext.decisionTimestamp) : undefined;
    if (trade.entryContext && (decision === undefined || decision >= entry)) throw new Error("Decision must precede next-open entry");
    const history = decision === undefined ? undefined : data.candles.slice(Math.max(0,decision+1-candleLimit),decision+1);
    const atr = history ? averageTrueRange(history,14) : undefined;
    const ema = history && history.length >= 21 ? emaSeries(history.map(c=>c.close),21).at(-1) : undefined;
    const decisionClose = history?.at(-1)?.close;
    // Next-open proxy positions hold every complete bar from entry until, but not including, the exit bar.
    // Exit-bar high/low might occur AFTER a stop: they cannot establish owned MFE/MAE.
    const owned = data.candles.slice(entry,exit);
    const extrema = (bars: typeof owned) => bars.length ? {
      favorableMoveRate: Math.max(0,...bars.map(c=>c.high/trade.entryPrice-1)),
      adverseMoveRate: Math.max(0,...bars.map(c=>1-c.low/trade.entryPrice)),
    } : null;
    return { symbol: trade.symbol, entryTimestamp: trade.entryTimestamp, exitTimestamp: trade.exitTimestamp, reason: trade.reason,
      netPnlUsdt: trade.netPnlUsdt, beforeFeesPnlUsdt: trade.netPnlUsdt+trade.feesUsdt, feesUsdt: trade.feesUsdt,
      btcEntryState: trade.entryContext?.btcState ?? "unknown", rsi14: trade.entryContext?.rsi14 ?? null,
      atrRate: atr !== undefined && decisionClose ? atr/decisionClose : null,
      extensionFromEma21Atr: atr && ema !== undefined && decisionClose ? (decisionClose-ema)/atr : null,
      breakEvenMarketMoveRate,
      ownedCompleteBars: owned.length, ownedExcursion: extrema(owned),
      forwardHorizons: horizons.map(bars => {
        const window = data.candles.slice(entry,entry+bars), complete = window.length === bars;
        return { bars, complete, includesExitOrLater: entry+bars>exit,
          excursion: complete ? extrema(window) : null,
          closeMoveRate: complete ? window.at(-1)!.close/trade.entryPrice-1 : null };
      }),
    };
  });
  const summarize = (items: typeof rows) => ({ trades: items.length,
    breakEvenMarketMoveRate: distribution(items.map(r=>r.breakEvenMarketMoveRate)),
    atrRate: distribution(items.flatMap(r=>r.atrRate===null?[]:[r.atrRate])),
    extensionFromEma21Atr: distribution(items.flatMap(r=>r.extensionFromEma21Atr===null?[]:[r.extensionFromEma21Atr])),
    ownedExcursionCoverage: items.filter(r=>r.ownedExcursion!==null).length,
    ownedFavorableMoveRate: distribution(items.flatMap(r=>r.ownedExcursion?[r.ownedExcursion.favorableMoveRate]:[])),
    ownedAdverseMoveRate: distribution(items.flatMap(r=>r.ownedExcursion?[r.ownedExcursion.adverseMoveRate]:[])),
    ownedHighReachedEstimatedBreakEven: items.filter(r=>r.ownedExcursion && r.ownedExcursion.favorableMoveRate>=r.breakEvenMarketMoveRate).length,
    horizons: horizons.map(bars=>{
      const available = items.map(r=>({row:r,horizon:r.forwardHorizons.find(h=>h.bars===bars)!})).filter(x=>x.horizon.complete);
      return { bars, completeSamples:available.length, missingSamples:items.length-available.length,
        includesExitOrLater:available.filter(x=>x.horizon.includesExitOrLater).length,
        favorableMoveRate:distribution(available.map(x=>x.horizon.excursion!.favorableMoveRate)),
        adverseMoveRate:distribution(available.map(x=>x.horizon.excursion!.adverseMoveRate)),
        meanCloseMoveRate:mean(available.map(x=>x.horizon.closeMoveRate!)),
        highReachedEstimatedBreakEven:available.filter(x=>x.horizon.excursion!.favorableMoveRate>=x.row.breakEvenMarketMoveRate).length };
    }),
  });
  const group = (key:(t:DiagnosticTrade)=>string) => [...new Set(trades.map(key))].sort().map(k=>{
    const selected = trades.filter(t=>key(t)===k), ids=new Set(selected.map(t=>`${t.symbol}:${t.entryTimestamp}:${t.exitTimestamp}`));
    return {key:k,accounting:diagnoseClosedTrades(selected).summary,...summarize(rows.filter(r=>ids.has(`${r.symbol}:${r.entryTimestamp}:${r.exitTimestamp}`)))};
  });
  return { status:"descriptive_economic_diagnosis_only", accounting:diagnoseClosedTrades(trades).summary,
    ...summarize(rows),byExitReason:group(t=>t.reason),byBtcEntryState:group(t=>t.entryContext?.btcState??"unknown"),
    bySymbol:group(t=>t.symbol),byEntryRsi:group(t=>{const r=t.entryContext?.rsi14;return r===undefined?"unknown":r<=58?"atMost58":r<=63?"above58to63":"above63";}),
    limitations:[
      "Frozen next-open simulation, not exchange observations. Complete held candles exclude the exit candle because intrabar order is unknown; same-bar exits have unknown owned excursion, not zero.",
      "Forward 1/4/8-bar windows are ex-post research, can include time after exit, overlap across trades and are not independent samples or achievable P&L. Missing windows are not zero-filled.",
      "A high crossing estimated break-even does not prove an executable profitable exit. Exit spread/slippage and fees are scenario assumptions; entry slippage is already in the recorded fill.",
      "Before-fees P&L includes spread/slippage in fills. BTC filter state is not a general regime label; entry ATR14 and EMA21 use only the exact preceding decision and runtime window.",
      "No parameter selection, entry/exit rule, order, deployment or real-money approval is produced.",
    ]};
}
