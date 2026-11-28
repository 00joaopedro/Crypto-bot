import type { PostgresPersistence } from './persistence.js';
import type { OkxDemoExecutor } from './okx-demo.js';

/** Private account catalogue + durable business rejections; never sends an order. */
export class DemoSymbolAccess {
  private cache: { account: string; at: number; symbols: Set<string> } | undefined;
  constructor(private readonly store: Pick<PostgresPersistence, 'demoSymbolRestrictions' | 'releaseDemoSymbolRestriction'>,
    private readonly executor: Pick<OkxDemoExecutor, 'inspectAccountIdentity' | 'availableAccountSymbols'>) {}
  async symbols(now = Date.now()): Promise<Set<string>> {
    const identity = await this.executor.inspectAccountIdentity();
    if (identity.status !== 'confirmed') throw new Error('demo_account_instruments_unconfirmed');
    const account = `${identity.identity.mainUid}:${identity.identity.uid}`;
    if (!this.cache || this.cache.account !== account || now - this.cache.at >= 300_000 || now < this.cache.at) {
      // Never use expired success after a failed refresh.
      this.cache = undefined;
      const symbols = await this.executor.availableAccountSymbols();
      this.cache = { account, at: now, symbols: new Set(symbols) };
    }
    const allowed = new Set(this.cache.symbols);
    for (const restriction of await this.store.demoSymbolRestrictions(account)) {
      const at = restriction.rejected_at.getTime();
      if (Number.isFinite(at) && now - at >= 6 * 3600_000 && allowed.has(restriction.symbol)) {
        await this.store.releaseDemoSymbolRestriction(account, restriction.symbol, restriction.client_order_id);
        // Require the next DB read to confirm the release (concurrent rejections win).
      }
      allowed.delete(restriction.symbol);
    }
    return allowed;
  }
  async check(symbol: string): Promise<{ status: 'safe' } | { status: 'blocked'; reason: 'demo_symbol_not_available_for_account' | 'demo_account_instruments_unconfirmed' }> {
    try { return (await this.symbols()).has(symbol) ? { status: 'safe' } : { status: 'blocked', reason: 'demo_symbol_not_available_for_account' }; }
    catch { return { status: 'blocked', reason: 'demo_account_instruments_unconfirmed' }; }
  }
}
