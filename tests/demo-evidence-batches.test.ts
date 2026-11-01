import { expect, it, vi } from 'vitest';
import { collectDemoEvidenceBatches } from '../src/demo-evidence-batches.js';
it('reads more than 500 journaled orders in bounded batches and refuses any incomplete batch', async () => {
  const journal = Array.from({ length: 501 }, (_, i) => ({ orderId: String(i), clientOrderId: `CB${i}`, symbol: 'BTC/USDT', attachedAlgoClientId: `AP${i}` }));
  const collectOrderEvidence = vi.fn(async () => ({ status: 'collected' as const, buys: [], sells: [], protections: [], orders: [], protectionStates: {} }));
  expect((await collectDemoEvidenceBatches({ collectOrderEvidence }, journal)).status).toBe('collected');
  expect(collectOrderEvidence).toHaveBeenCalledTimes(6);
  for (const call of collectOrderEvidence.mock.calls) expect(call.length).toBe(1);
  const uncertain = vi.fn().mockResolvedValueOnce({ status: 'collected', buys: [], sells: [], protections: [], orders: [], protectionStates: {} }).mockResolvedValue({ status: 'unavailable', reason: 'provider_unavailable' });
  expect(await collectDemoEvidenceBatches({ collectOrderEvidence: uncertain }, journal)).toMatchObject({ status: 'unavailable', reason: 'provider_unavailable' });
});
