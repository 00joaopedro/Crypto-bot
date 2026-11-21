import type { DemoRiskOptions } from "./demo-risk-equity.js";
import { inspectDemoEquityRisk, type DemoEquityRiskResult } from "./demo-entry.js";
import { inspectDemoExecutionSafety } from "./demo-execution-safety.js";
import { sameDemoAccount } from "./okx-demo-identity.js";
import type { PostgresPersistence } from "./persistence.js";
import type { OkxDemoExecutor } from "./okx-demo.js";

/** Runs the Demo safety checks before admitting an operator resume. */
export async function inspectDemoResume(
  persistence: Pick<PostgresPersistence, "demoOrderJournal" | "getDemoBaselineCandidate" | "observeDemoRisk"> & Partial<Pick<PostgresPersistence, "getDemoAccountingCheckpoint">>,
  executor: Pick<OkxDemoExecutor, "collectOrderEvidence" | "inspectAccountIdentity" | "inspectTradingPermission" | "getAccountSnapshot"> & Partial<Pick<OkxDemoExecutor, "inspectExitProtection">>,
  limits: DemoRiskOptions & { maxDailyLoss: number; maxDrawdown: number },
): Promise<DemoEquityRiskResult> {
  try {
    const baseline = await persistence.getDemoBaselineCandidate();
    const account = await executor.inspectAccountIdentity();
    if (!baseline || account.status !== "confirmed" || !sameDemoAccount(baseline.evidence.accountIdentity, account.identity)) return { status: "blocked", reason: "demo_account_identity_unconfirmed" };
    const permission = await executor.inspectTradingPermission();
    if (permission.status !== "available" || !permission.trading) return { status: "blocked", reason: "demo_trading_permission_unconfirmed" };
    const safety = await inspectDemoExecutionSafety(persistence, executor);
    if (safety.status !== "safe") return safety;
    return await inspectDemoEquityRisk(persistence, executor, limits.maxDailyLoss, limits.maxDrawdown, limits);
  } catch { return { status: "blocked", reason: "demo_resume_check_failed" }; }
}
