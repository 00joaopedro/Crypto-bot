export type OutOfSampleEvidence = {
  operations: number;
  netReturnPercent: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  profitableWindows: number;
  totalWindows: number;
};

export type RealCapitalReadinessOptions = {
  minimumOperations?: number;
  minimumWindows?: number;
  minimumProfitableWindowRate?: number;
  maximumDrawdownPercent?: number;
  maximumExposurePercent?: number;
  maximumRiskPerTradePercent?: number;
  killSwitchEnabled: boolean;
  liveTradingEnabled: boolean;
};

export type RealCapitalReadiness = {
  eligible: boolean;
  reasons: string[];
  evidence: OutOfSampleEvidence;
  limits: Required<Omit<RealCapitalReadinessOptions, "killSwitchEnabled" | "liveTradingEnabled">> & {
    killSwitchEnabled: boolean;
    liveTradingEnabled: boolean;
  };
};

/** Safety gate only: it evaluates evidence and never enables live execution. */
export function evaluateRealCapitalReadiness(
  evidence: OutOfSampleEvidence,
  options: RealCapitalReadinessOptions,
): RealCapitalReadiness {
  const limits = {
    minimumOperations: options.minimumOperations ?? 200,
    minimumWindows: options.minimumWindows ?? 3,
    minimumProfitableWindowRate: options.minimumProfitableWindowRate ?? 0.6,
    maximumDrawdownPercent: options.maximumDrawdownPercent ?? 5,
    maximumExposurePercent: options.maximumExposurePercent ?? 1,
    maximumRiskPerTradePercent: options.maximumRiskPerTradePercent ?? 0.25,
    killSwitchEnabled: options.killSwitchEnabled,
    liveTradingEnabled: options.liveTradingEnabled,
  };
  const counts = [evidence.operations, evidence.profitableWindows, evidence.totalWindows];
  if (counts.some((value) => !Number.isInteger(value) || value < 0)) throw new Error("evidence counts must be finite non-negative integers");
  if (evidence.profitableWindows > evidence.totalWindows) throw new Error("profitableWindows cannot exceed totalWindows");
  if (![evidence.netReturnPercent, evidence.maxDrawdownPercent].every(Number.isFinite) || Number.isNaN(evidence.profitFactor) || evidence.profitFactor < 0) throw new Error("evidence metrics must be finite");
  if (!Number.isInteger(limits.minimumOperations) || limits.minimumOperations < 100) throw new Error("minimumOperations must be at least 100");
  if (!Number.isInteger(limits.minimumWindows) || limits.minimumWindows < 2) throw new Error("minimumWindows must be at least 2");
  if (!Number.isFinite(limits.minimumProfitableWindowRate) || limits.minimumProfitableWindowRate <= 0 || limits.minimumProfitableWindowRate > 1) throw new Error("minimumProfitableWindowRate must be between 0 and 1");
  if (!Number.isFinite(limits.maximumDrawdownPercent) || limits.maximumDrawdownPercent <= 0) throw new Error("maximumDrawdownPercent must be positive");
  if (!Number.isFinite(limits.maximumExposurePercent) || limits.maximumExposurePercent <= 0 || limits.maximumExposurePercent > 1) throw new Error("maximumExposurePercent must be between 0 and 1");
  if (!Number.isFinite(limits.maximumRiskPerTradePercent) || limits.maximumRiskPerTradePercent <= 0 || limits.maximumRiskPerTradePercent > limits.maximumExposurePercent) throw new Error("maximumRiskPerTradePercent must not exceed maximumExposurePercent");
  const reasons: string[] = [];
  if (evidence.operations < limits.minimumOperations) reasons.push(`Amostra fora da amostra insuficiente: ${evidence.operations}/${limits.minimumOperations} operações.`);
  if (evidence.totalWindows < limits.minimumWindows) reasons.push(`Janelas fora da amostra insuficientes: ${evidence.totalWindows}/${limits.minimumWindows}.`);
  const windowRate = evidence.totalWindows > 0 ? evidence.profitableWindows / evidence.totalWindows : 0;
  if (windowRate < limits.minimumProfitableWindowRate) reasons.push("A consistência entre janelas ainda está abaixo do mínimo.");
  if (!Number.isFinite(evidence.netReturnPercent) || evidence.netReturnPercent <= 0) reasons.push("O retorno líquido fora da amostra não é positivo.");
  if (evidence.profitFactor <= 1) reasons.push("O profit factor fora da amostra não é maior que 1.");
  if (!Number.isFinite(evidence.maxDrawdownPercent) || evidence.maxDrawdownPercent > limits.maximumDrawdownPercent) reasons.push("O drawdown fora da amostra excede o limite.");
  if (!limits.killSwitchEnabled) reasons.push("Kill switch não está habilitado.");
  if (limits.liveTradingEnabled) reasons.push("Trading real está bloqueado nesta etapa; não é permitido habilitá-lo.");
  return { eligible: reasons.length === 0, reasons, evidence, limits };
}
