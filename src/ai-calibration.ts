export type AiCalibrationOpportunity = {
  netPnlUsdt: number;
  aiApprove: boolean;
  aiConfidence: number;
};
export type AiCalibrationMetrics = {
  scenario: string;
  confidenceThreshold: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnlUsdt: number;
  expectancyUsdt: number;
  profitFactor: number;
  maxDrawdownPercent: number;
};
export type AiCalibrationResult = {
  noAi: AiCalibrationMetrics;
  thresholds: AiCalibrationMetrics[];
  bestByNetPnl: AiCalibrationMetrics;
  aiImprovesNetPnl: boolean;
  warnings: string[];
};

/** Compares IA policies using already-recorded decisions; it never calls Gemini. */
export function calibrateAi(opportunities: AiCalibrationOpportunity[], confidenceThresholds = [0.5, 0.7, 0.8], initialBalanceUsdt = 1000): AiCalibrationResult {
  if (!Number.isFinite(initialBalanceUsdt) || initialBalanceUsdt <= 0) throw new Error("initialBalanceUsdt must be positive");
  if (confidenceThresholds.length === 0 || confidenceThresholds.some((threshold) => !Number.isFinite(threshold) || threshold < 0 || threshold > 1)) throw new Error("confidence thresholds must be between 0 and 1");
  const noAi = metrics("WITHOUT_AI", 0, opportunities, () => true, initialBalanceUsdt);
  const thresholds = confidenceThresholds.map((threshold) => metrics(`AI_${threshold}`, threshold, opportunities, (opportunity) => opportunity.aiApprove && opportunity.aiConfidence >= threshold, initialBalanceUsdt));
  const bestByNetPnl = [noAi, ...thresholds].reduce((best, current) => current.netPnlUsdt > best.netPnlUsdt ? current : best);
  const warnings: string[] = [];
  if (opportunities.length < 100) warnings.push(`Amostra de IA insuficiente: ${opportunities.length}/100 oportunidades.`);
  if (thresholds.every((result) => result.trades === 0)) warnings.push("Nenhum limiar de confiança aprovou operações.");
  return { noAi, thresholds, bestByNetPnl, aiImprovesNetPnl: bestByNetPnl.scenario !== "WITHOUT_AI" && bestByNetPnl.netPnlUsdt > noAi.netPnlUsdt, warnings };
}

function metrics(scenario: string, confidenceThreshold: number, opportunities: AiCalibrationOpportunity[], accepted: (opportunity: AiCalibrationOpportunity) => boolean, initialBalanceUsdt: number): AiCalibrationMetrics {
  const pnls = opportunities.filter(accepted).map((opportunity) => opportunity.netPnlUsdt);
  const wins = pnls.filter((pnl) => pnl > 0);
  const losses = Math.abs(pnls.filter((pnl) => pnl < 0).reduce((sum, pnl) => sum + pnl, 0));
  let equity = initialBalanceUsdt;
  let peak = equity;
  let maxDrawdownPercent = 0;
  for (const pnl of pnls) { equity += pnl; peak = Math.max(peak, equity); maxDrawdownPercent = Math.max(maxDrawdownPercent, peak > 0 ? ((peak - equity) / peak) * 100 : 0); }
  const netPnlUsdt = pnls.reduce((sum, pnl) => sum + pnl, 0);
  return { scenario, confidenceThreshold, trades: pnls.length, wins: wins.length, losses: pnls.filter((pnl) => pnl < 0).length, winRate: pnls.length ? wins.length / pnls.length * 100 : 0, netPnlUsdt, expectancyUsdt: pnls.length ? netPnlUsdt / pnls.length : 0, profitFactor: losses === 0 ? (wins.length ? Number.POSITIVE_INFINITY : 0) : wins.reduce((sum, pnl) => sum + pnl, 0) / losses, maxDrawdownPercent };
}
