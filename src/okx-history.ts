import type { Candle } from "./types.js";
import { REGIME_CANDLE_MS } from "./btc-regime.js";

export const OKX_HISTORY_ENDPOINT = "/api/v5/market/history-candles";

type FetchPage = (request: { instId: string; bar: "15m" | "1H"; after: string; limit: string }) => Promise<unknown>;

export class MissingConfirmedCandleError extends Error {
  constructor(readonly timestamp:number,readonly duration:number) {
    super(`Missing confirmed OKX candle at ${new Date(timestamp).toISOString()}`);
    this.name='MissingConfirmedCandleError';
  }
}

function numberFromOkx(value: unknown): number {
  return typeof value === "string" && value.trim() ? Number(value) : NaN;
}

/** Collect exactly the closed Spot candles in [start, end), oldest first. */
export async function collectOkxSpotHistory(
  fetchPage: FetchPage,
  instId: string,
  start: number,
  end: number,
  now = Date.now(),
  bar: "15m" | "1H" = "15m",
): Promise<Candle[]> {
  const duration = bar === "1H" ? 3600000 : REGIME_CANDLE_MS;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= end ||
      start % duration !== 0 || end % duration !== 0 || end > now) {
    throw new Error("Invalid OKX history window. Use completed, aligned candle intervals.");
  }
  const candles = new Map<number, Candle>();
  let cursor = end;

  while (cursor > start) {
    const payload = await fetchPage({ instId, bar, after: String(cursor), limit: "300" });
    if (!payload || typeof payload !== "object" || !("code" in payload) || payload.code !== "0" ||
        !("data" in payload) || !Array.isArray(payload.data)) {
      throw new Error("OKX returned an invalid history page");
    }
    if (payload.data.length === 0) break;
    let oldest = cursor;
    for (const row of payload.data) {
      if (!Array.isArray(row) || row.length < 9) throw new Error("OKX returned an invalid historical candle");
      const timestamp = numberFromOkx(row[0]);
      if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp % duration) {
        throw new Error("OKX returned an invalid candle timestamp");
      }
      oldest = Math.min(oldest, timestamp);
      if (timestamp < start || timestamp >= end) continue;
      if (row[8] === "0") continue;
      if (row[8] !== "1") throw new Error("OKX returned an invalid candle confirmation flag");

      const [open, high, low, close, volume] = row.slice(1, 6).map(numberFromOkx) as [number, number, number, number, number];
      if (![open, high, low, close, volume].every(Number.isFinite) || low <= 0 ||
          low > Math.min(open, close) || high < Math.max(open, close) || volume < 0) {
        throw new Error(`Invalid OHLCV at ${new Date(timestamp).toISOString()}`);
      }
      const candle = { timestamp, open, high, low, close, volume };
      const existing = candles.get(timestamp);
      if (existing && (existing.open !== open || existing.high !== high || existing.low !== low ||
          existing.close !== close || existing.volume !== volume)) {
        throw new Error(`Conflicting OKX candles at ${new Date(timestamp).toISOString()}`);
      }
      candles.set(timestamp, candle);
    }
    if (oldest >= cursor) throw new Error("OKX history pagination did not advance");
    cursor = oldest;
  }

  const ordered: Candle[] = [];
  for (let timestamp = start; timestamp < end; timestamp += duration) {
    const candle = candles.get(timestamp);
    if (!candle) throw new MissingConfirmedCandleError(timestamp,duration);
    ordered.push(candle);
  }
  return ordered;
}
