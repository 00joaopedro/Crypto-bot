/** Inputs are net P&L amounts in USDT from closed trades in the reported sample. */
export function tradeProfitConcentration(tradePnlsUsdt: readonly number[], grossProfitUsdt: number, realizedPnlUsdt: number) {
  const topWinningTradePnLsUsdt = tradePnlsUsdt.filter(pnl => pnl > 0).sort((a, b) => b - a).slice(0, 3);
  const top3ProfitUsdt = topWinningTradePnLsUsdt.reduce((sum, pnl) => sum + pnl, 0);
  const top3TradesProfitSharePercent = grossProfitUsdt > 0 ? top3ProfitUsdt / grossProfitUsdt * 100 : null;
  return {
    topWinningTradePnLsUsdt,
    top3TradesProfitSharePercent,
    realizedPnlWithoutTop3Usdt: realizedPnlUsdt - top3ProfitUsdt,
    top3ProfitConcentrationWarning: top3TradesProfitSharePercent !== null && top3TradesProfitSharePercent > 35,
  };
}
