import type { JournaledDemoBuy } from './demo-ownership.js';
import type { OkxDemoExecutor } from './okx-demo.js';
import type { OrderEvidenceResult, CachedDemoParent } from './okx-demo-order-evidence.js';

/** Provider request bounds apply per batch, not to lifetime bot activity. */
export async function collectDemoEvidenceBatches(executor: Pick<OkxDemoExecutor, 'collectOrderEvidence'>, journal: JournaledDemoBuy[], cachedParents: CachedDemoParent[] = []): Promise<OrderEvidenceResult> {
  const result: Extract<OrderEvidenceResult, { status: 'collected' }> = { status: 'collected', buys: [], sells: [], protections: [], orders: [], protectionStates: {} };
  for (let start = 0; start < journal.length; start += 100) {
    const batch = await executor.collectOrderEvidence(journal.slice(start, start+100), cachedParents.filter(parent => journal.slice(start, start+100).some(buy => buy.orderId === parent.order.id)));
    if (batch.status !== 'collected') return batch;
    result.buys.push(...batch.buys); result.sells.push(...batch.sells);
    result.protections.push(...batch.protections); result.orders.push(...batch.orders);
    for (const [id, state] of Object.entries(batch.protectionStates)) {
      if (id in result.protectionStates) return { status: 'unavailable', reason: 'duplicate_protection_across_batches' };
      result.protectionStates[id] = state;
    }
  }
  return result;
}
