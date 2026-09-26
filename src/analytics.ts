export type StatisticalTrade = { symbol: string; netPnlUsdt: number; exitTimestamp: number; regime: string; aiState: string };
export type StatisticalMetrics = { trades: number; wins: number; losses: number; winRate: number; netPnlUsdt: number; profitFactor: number | "Infinity"; expectancyUsdt: number; maxDrawdownUsdt: number };
export type StatisticalReport = StatisticalMetrics & { bySymbol: Record<string, StatisticalMetrics>; byHour: Record<string, StatisticalMetrics>; byRegime: Record<string, StatisticalMetrics>; byAiState: Record<string, StatisticalMetrics> };
export function buildStatisticalReport(trades: StatisticalTrade[]): StatisticalReport {
  const group = (key: (trade: StatisticalTrade) => string) => Object.fromEntries([...new Set(trades.map(key))].sort().map((value) => [value, metrics(trades.filter((trade) => key(trade) === value))]));
  return { ...metrics(trades), bySymbol: group((trade) => trade.symbol), byHour: group((trade) => String(new Date(trade.exitTimestamp).getUTCHours()).padStart(2, "0")), byRegime: group((trade) => trade.regime), byAiState: group((trade) => trade.aiState) };
}
function metrics(trades: StatisticalTrade[]): StatisticalMetrics {
  let equity = 0; let peak = 0; let maxDrawdown = 0;
  for (const trade of [...trades].sort((a, b) => a.exitTimestamp - b.exitTimestamp)) { equity += trade.netPnlUsdt; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); }
  const wins = trades.filter((trade) => trade.netPnlUsdt > 0).length;
  const grossProfit = trades.filter((trade) => trade.netPnlUsdt > 0).reduce((sum, trade) => sum + trade.netPnlUsdt, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.netPnlUsdt < 0).reduce((sum, trade) => sum + trade.netPnlUsdt, 0));
  const netPnlUsdt = trades.reduce((sum, trade) => sum + trade.netPnlUsdt, 0);
  return { trades: trades.length, wins, losses: trades.length - wins, winRate: trades.length ? wins / trades.length * 100 : 0, netPnlUsdt, profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? "Infinity" : 0, expectancyUsdt: trades.length ? netPnlUsdt / trades.length : 0, maxDrawdownUsdt: maxDrawdown };
}
