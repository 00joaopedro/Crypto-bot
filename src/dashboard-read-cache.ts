/** UI-only stale-while-refresh. Never used by trading admission or risk checks. */
export class DashboardRead<T> {
  private value: T;
  private expiresAt = 0;
  private pending: Promise<T> | undefined;
  private updatedAt: number | null = null;
  private failed = false;
  constructor(private readonly read: () => Promise<T>, initial: T, private readonly intervalMs = 60_000) { this.value = initial; }
  get(): Promise<T> {
    if (this.pending) return this.pending;
    if (Date.now() < this.expiresAt) return Promise.resolve(this.value);
    this.pending = Promise.resolve().then(this.read).then(value => {
      this.value = value; this.updatedAt = Date.now(); this.failed = false; return value;
    }).catch(() => { this.failed = true; return this.value; }).finally(() => {
      this.expiresAt = Date.now() + (this.failed ? 5000 : this.intervalMs); this.pending = undefined;
    });
    return this.pending;
  }
  peek(): T { void this.get(); return this.value; }
  status() { return { refreshing: Boolean(this.pending), updatedAt: this.updatedAt, failed: this.failed }; }
}
