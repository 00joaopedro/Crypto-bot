import type { DemoFill } from "./demo-ledger.js";
import type { CachedDemoParent } from "./okx-demo-order-evidence.js";
import { createHash } from "node:crypto";
import { advanceExitStop } from "./exit-policy.js";
import { sameDemoAccount } from "./okx-demo-identity.js";
import type { PostgresPersistence } from "./persistence.js";
import type { OkxDemoExecutor } from "./okx-demo.js";
import type { PublicMarketData } from "./market-data.js";

type Store = Pick<PostgresPersistence, "managedDemoExits" | "saveDemoExitState"> & Partial<Pick<PostgresPersistence,"getDemoBaselineCandidate" | "getDemoAccountingCheckpoint">>;
type Executor = Pick<OkxDemoExecutor, "inspectAccountIdentity" | "inspectExitProtection" | "formatExitStop" | "amendExitStop" | "exitManagementEnabled">;

/** A single durable pending amendment owns the slot until exchange readback proves it.
 * It never expires into another submission: timeouts and restarts cannot duplicate orders.
 */
export async function superviseDemoExits(store: Store, executor: Executor, market: Pick<PublicMarketData, "fetchClosedCandles" | "active">, limit = 200) {
  const blocked = (reason: string) => ({ status: "blocked" as const, reason });
  try {
    const rows = await store.managedDemoExits();
    if (!rows.length) return { status: "safe" as const };
    const account = await executor.inspectAccountIdentity();
    if (account.status !== "confirmed") return blocked("exit_account_unconfirmed");
    const baseline = await store.getDemoBaselineCandidate?.();
    const checkpoint = baseline && sameDemoAccount(baseline.evidence.accountIdentity,account.identity) ? await store.getDemoAccountingCheckpoint?.(baseline.observedAt) : null;
    const cached = checkpoint ? { parents: (checkpoint.evidence.parentOrderEvidence ?? []) as CachedDemoParent[], fills: ((checkpoint.evidence.ledgerCarry as { fills?: DemoFill[] } | undefined)?.fills ?? checkpoint.evidence.reconciledFills ?? []) as DemoFill[], from: checkpoint.observedAt.getTime() } : undefined;
    const superviseOne = async (row: (typeof rows)[number]) => {
      if (!sameDemoAccount(row.state.accountIdentity, account.identity)) return blocked("exit_account_mismatch");
      if (row.status === "REJECTED_CONFIRMED" && !row.state.pending) {
        const saved = await store.saveDemoExitState(row.algo_client_id, row.version, { ...row.state, closed: true });
        return saved ? { status: "safe" as const } : blocked("exit_state_changed");
      }
      if (row.status !== "PLACED") return blocked("exit_parent_unresolved");
      const orderId = (row.result as { orderId?: unknown } | null)?.orderId;
      if (typeof orderId !== "string" || !orderId) return blocked("exit_parent_id_missing");
      const from = new Date(row.created_at).getTime();
      if (!Number.isSafeInteger(from) || from <= 0) return blocked("exit_journal_date_invalid");
      const journal = { orderId, clientOrderId: row.client_order_id, attachedAlgoClientId: row.algo_client_id, symbol: row.symbol };
      const observed = await executor.inspectExitProtection(journal, from, cached);
      if (observed.status === "blocked") return blocked(observed.reason);
      if (observed.status === "closed") {
        if (!await store.saveDemoExitState(row.algo_client_id,row.version,{ ...row.state, pending: null, closed: true })) return blocked("exit_state_changed");
        return { status: "safe" as const };
      }
      // A lowered or externally altered stop is not silently adopted.
      if (observed.stop < row.state.stop) return blocked("exit_stop_regressed");
      if (row.state.pending) {
        if (observed.stop < row.state.pending.stop) return blocked("exit_amendment_unconfirmed");
        if (!await store.saveDemoExitState(row.algo_client_id,row.version,{ ...row.state, stop: observed.stop, pending: null })) return blocked("exit_state_changed");
        // A separate cycle handles the next closed candle, avoiding two writes
        // after an uncertain response and eliminating stale version reuse.
        return { status: "safe" as const };
      }
      if (!executor.exitManagementEnabled) return { status: "safe" as const };
      const candles = await market.fetchClosedCandles(row.symbol, limit);
      if (market.active !== "okx") return blocked("exit_requires_okx_candles");
      if (!candles.length || candles.some((c,i) => ![c.open,c.high,c.low,c.close,c.timestamp].every(Number.isFinite) || c.open <= 0 || c.close <= 0 || c.low <= 0 || c.low > Math.min(c.open,c.close) || c.high < Math.max(c.open,c.close) || (i > 0 && c.timestamp - candles[i-1]!.timestamp !== 900000))) return blocked("exit_candles_invalid");
      const latest = candles.at(-1)!;
      if (latest.timestamp + 900000 > Date.now() || Date.now() - (latest.timestamp + 900000) > 900000) return blocked("exit_candles_stale");
      const lastCandle = Math.max(row.state.lastCandle, observed.entryCandle);
      const unseen = candles.filter(c => c.timestamp > lastCandle);
      if (!unseen.length) return { status: "safe" as const };
      if (unseen[0]!.timestamp !== lastCandle + 900000) return blocked("exit_candle_gap");
      if (row.state.policy.breakeven && observed.takerFeeRate === null) return blocked("exit_fee_unconfirmed");
      const policy = { ...row.state.policy, exitFeeRate: Math.max(row.state.policy.exitFeeRate, observed.takerFeeRate ?? 0) };
      let highWatermark = row.state.highWatermark;
      let stop = observed.stop;
      // Replay peaks, but do not submit retrospective amendments or fills.
      // Only the final closed-candle proposal can reach the exchange now.
      for (const c of unseen) {
        const history = candles.filter(item => item.timestamp <= c.timestamp);
        if (history.length <= row.state.policy.atrPeriod) return blocked("exit_atr_warmup_missing");
        const next = advanceExitStop({ stop, highWatermark, entryPrice: observed.entryPrice, quantity: observed.netQuantity, costUsdt: observed.costUsdt, candles: history, policy });
        highWatermark = next.highWatermark;
        stop = next.stop;
      }
      stop = executor.formatExitStop(row.symbol, stop);
      if (!Number.isFinite(stop) || stop <= 0) return blocked("exit_price_precision_invalid");
      if (stop >= latest.close) stop = observed.stop;
      const requestId = createHash("sha256").update(`${row.algo_client_id}:${row.version}:${latest.timestamp}:${stop}`).digest("hex").slice(0,32);
      const improving = stop > observed.stop;
      const state = { ...row.state, highWatermark, lastCandle: latest.timestamp, stop: observed.stop, pending: improving ? { requestId, stop } : null };
      // Reserve durably BEFORE the network request. A failed write submits nothing.
      if (!await store.saveDemoExitState(row.algo_client_id,row.version,state)) return blocked("exit_state_changed");
      if (improving) {
        const result = await executor.amendExitStop(journal, from, stop, requestId,cached);
        if (result === "blocked") {
          // The executor only returns blocked before sending the amendment.
          const saved = await store.saveDemoExitState(row.algo_client_id, row.version + 1, { ...state, pending: null });
          return blocked(saved ? "exit_amendment_not_submitted" : "exit_state_changed");
        }
        if (result === "rejected") {
          if (!await store.saveDemoExitState(row.algo_client_id,row.version+1,{...state,pending:null})) return blocked("exit_state_changed");
          return blocked("exit_amendment_rejected");
        }
        // Success acknowledgement is deliberately not used to clear the slot.
        return blocked("exit_amendment_awaiting_readback");
      }
      return { status: "safe" as const };
    };
    let failure: string | undefined;
    for (const row of rows) {
      try { const result = await superviseOne(row); if (result.status === "blocked") { if (!failure || ["exit_amendment_awaiting_readback","exit_amendment_unconfirmed","exit_amendment_not_submitted"].includes(failure)) failure = result.reason; } } catch { failure ??= "exit_supervision_failed"; }
    }
    return failure ? blocked(failure) : { status: "safe" as const };
  } catch { return blocked("exit_supervision_failed"); }
}

/** Continuous read-only coverage check, including positions opened before managed exits. */
export async function auditDemoProtections(store: Pick<PostgresPersistence, "demoOrderJournal" | "getDemoBaselineCandidate" | "getDemoAccountingCheckpoint">, executor: Pick<OkxDemoExecutor, "inspectAccountIdentity" | "inspectExitProtection">) {
  try {
    const rows = await store.demoOrderJournal();
    const placed = rows.filter(r => r.status === "PLACED");
    if (!placed.length) return { status: "safe" as const };
    const baseline = await store.getDemoBaselineCandidate();
    const account = await executor.inspectAccountIdentity();
    if (!baseline || account.status !== "confirmed" || !sameDemoAccount(baseline.evidence.accountIdentity,account.identity)) return { status: "blocked" as const, reason: "protection_account_unconfirmed" };
    const checkpoint = await store.getDemoAccountingCheckpoint(baseline.observedAt);
    const carry = checkpoint?.evidence.ledgerCarry as { from?: number } | undefined;
    const from = carry?.from ?? checkpoint?.observedAt.getTime() ?? baseline.observedAt.getTime();
    const cached = checkpoint ? { parents: (checkpoint.evidence.parentOrderEvidence ?? []) as CachedDemoParent[], fills: ((checkpoint.evidence.ledgerCarry as { fills?: DemoFill[] } | undefined)?.fills ?? checkpoint.evidence.reconciledFills ?? []) as DemoFill[], from: checkpoint.observedAt.getTime() } : undefined;
    for (const row of placed.filter(r => new Date(r.created_at).getTime() >= from)) {
      const orderId = (row.result as { orderId?: unknown } | null)?.orderId;
      if (typeof orderId !== "string" || !row.attached_algo_client_id) return { status: "blocked" as const, reason: "protection_identity_missing" };
      const result = await executor.inspectExitProtection({ orderId,clientOrderId:row.client_order_id,symbol:row.symbol,attachedAlgoClientId:row.attached_algo_client_id },new Date(row.created_at).getTime(),cached);
      if (result.status === "blocked") return result;
    }
    return { status: "safe" as const };
  } catch { return { status: "blocked" as const, reason: "protection_audit_failed" }; }
}
