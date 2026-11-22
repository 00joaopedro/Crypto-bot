import type { Candle } from './types.js';
const STEP = 900_000;

/** Bounded, same-venue replay with warmup. No interpolation or assumed fills. */
export async function collectPaperHistory(cursor: number, through: number,
  fetchPage: (since: number, limit: number) => Promise<Array<Array<number | undefined>>>): Promise<Candle[]> {
  if (![cursor, through].every(x => Number.isSafeInteger(x) && x >= 0 && x % STEP === 0) || cursor > through) throw new Error('invalid_recovery_window');
  const start = Math.max(0, cursor - 100 * STEP);
  const rows = new Map<number, Candle>();
  let since = start;
  const deadline = Date.now() + 20_000;
  for (let page = 0; page < 32 && since <= through; page++) {
    if (Date.now() >= deadline) throw new Error('paper_history_time_budget_exceeded');
    const raw = await fetchPage(since, 100);
    if (!raw.length) throw new Error('paper_history_incomplete');
    let next = since;
    for (const row of raw) {
      const [timestamp, open, high, low, close, volume] = row;
      if (![timestamp, open, high, low, close, volume].every(x => typeof x === 'number' && Number.isFinite(x)) ||
        !Number.isSafeInteger(timestamp) || timestamp! % STEP || open! <= 0 || close! <= 0 || low! <= 0 ||
        high! < Math.max(open!, close!) || low! > Math.min(open!, close!) || volume! < 0) throw new Error('invalid_recovery_candle');
      if (timestamp! < start || timestamp! > through) continue;
      const candle = { timestamp: timestamp!, open: open!, high: high!, low: low!, close: close!, volume: volume! };
      const previous = rows.get(timestamp!);
      if (previous && JSON.stringify(previous) !== JSON.stringify(candle)) throw new Error('conflicting_recovery_candle');
      rows.set(timestamp!, candle);
      next = Math.max(next, timestamp! + STEP);
    }
    if (next <= since) throw new Error('paper_history_no_progress');
    since = next;
  }
  if (since <= through) throw new Error('paper_history_budget_exceeded');
  const result = [...rows.values()].sort((a,b) => a.timestamp-b.timestamp);
  for (let expected = start, i = 0; expected <= through; expected += STEP, i++) {
    if (result[i]?.timestamp !== expected) throw new Error('paper_history_gap');
  }
  return result;
}
