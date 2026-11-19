import { expect, it } from "vitest";
import { tradeProfitConcentration } from "../src/backtest-performance.js";

it("measures concentration against winning P&L and exposes a loss without the top three", () => {
  expect(tradeProfitConcentration([1, -12, 5, 2, 4, 3], 15, 3)).toEqual({
    topWinningTradePnLsUsdt: [5, 4, 3],
    top3TradesProfitSharePercent: 80,
    realizedPnlWithoutTop3Usdt: -9,
    top3ProfitConcentrationWarning: true,
  });
});

it("handles absent winners and keeps the warning off at exactly 35 percent", () => {
  expect(tradeProfitConcentration([], 0, 0)).toMatchObject({
    topWinningTradePnLsUsdt: [], top3TradesProfitSharePercent: null,
    realizedPnlWithoutTop3Usdt: 0, top3ProfitConcentrationWarning: false,
  });
  expect(tradeProfitConcentration([12, 12, 11], 100, 30).top3ProfitConcentrationWarning).toBe(false);
});
