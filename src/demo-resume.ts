import { inspectDemoExecutionSafety } from "./demo-execution-safety.js";
import { sameDemoAccount } from "./okx-demo-identity.js";
import type { PostgresPersistence } from "./persistence.js";
import type { OkxDemoExecutor } from "./okx-demo.js";

/** Read-only preflight. The caller applies the resume only while this result
 * and the bot/executor references are still current. */
export async function inspectDemoResume(
  persistence: Pick<PostgresPersistence, "demoOrderJournal" | "getDemoBaselineCandidate">,
  executor: Pick<OkxDemoExecutor, "collectOrderEvidence" | "inspectAccountIdentity" | "inspectTradingPermission">,
): Promise<{ status: "safe" } | { status: "blocked"; reason: string }> {
  try {
    const baseline = await persistence.getDemoBaselineCandidate();
    const account = await executor.inspectAccountIdentity();
    if (!baseline || account.status !== "confirmed" || !sameDemoAccount(baseline.evidence.accountIdentity, account.identity)) return { status: "blocked", reason: "demo_account_identity_unconfirmed" };
    const permission = await executor.inspectTradingPermission();
    if (permission.status !== "available" || !permission.trading) return { status: "blocked", reason: "demo_trading_permission_unconfirmed" };
    return await inspectDemoExecutionSafety(persistence, executor);
  } catch { return { status: "blocked", reason: "demo_resume_check_failed" }; }
}
