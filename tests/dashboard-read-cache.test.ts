import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardRead } from '../src/dashboard-read-cache.js';

describe('dashboard diagnostics cache', () => {
  afterEach(() => vi.useRealTimers());
  it('returns a snapshot immediately while coalescing slow exchange requests', async () => {
    let release!: (value: number) => void;
    const read = vi.fn(() => new Promise<number>(resolve => { release = resolve; }));
    const cache = new DashboardRead(read, 0);
    expect(cache.peek()).toBe(0);expect(cache.peek()).toBe(0);
    expect(cache.status()).toEqual({ refreshing: true, updatedAt: null, failed: false });
    await Promise.resolve();expect(read).toHaveBeenCalledTimes(1);
    release(42);expect(await cache.get()).toBe(42);
    expect(cache.peek()).toBe(42);expect(cache.status().refreshing).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('preserves prior readings on failure and retries without calling them fresh', async () => {
    vi.useFakeTimers();const read = vi.fn().mockResolvedValueOnce(5).mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(7);
    const cache = new DashboardRead<number>(read, 0, 1000);
    expect(await cache.get()).toBe(5);const firstAt=cache.status().updatedAt;
    vi.advanceTimersByTime(1001);expect(await cache.get()).toBe(5);
    expect(cache.status()).toEqual({ refreshing: false, updatedAt: firstAt, failed: true });
    vi.advanceTimersByTime(5001);expect(await cache.get()).toBe(7);expect(cache.status().failed).toBe(false);
  });
});
