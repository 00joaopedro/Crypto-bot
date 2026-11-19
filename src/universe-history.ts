import { collectOkxSpotHistory } from "./okx-history.js";

export async function collectUniverseHistory(
  fetchPage: Parameters<typeof collectOkxSpotHistory>[0], instrumentId: string,
  start: number, end: number, now: number,
) {
  const quotes = new Map<number, number>();
  const candles = await collectOkxSpotHistory(async request => {
    const page = await fetchPage(request);
    const rows = (page as { data?: unknown })?.data;
    if (Array.isArray(rows)) for (const row of rows) {
      if (!Array.isArray(row) || row[8] !== "1") continue;
      const timestamp = Number(row[0]);
      if (timestamp < start || timestamp >= end) continue;
      const volume = typeof row[7] === "string" && row[7].trim() ? Number(row[7]) : NaN;
      if (!Number.isFinite(volume) || volume < 0 || (quotes.has(timestamp) && quotes.get(timestamp) !== volume)) throw new Error("Invalid or conflicting historical quote volume");
      quotes.set(timestamp, volume);
    }
    return page;
  }, instrumentId, start, end, now);
  return { candles, quoteVolumesUsdt: candles.map(c => {
    const volume = quotes.get(c.timestamp);
    if (volume === undefined) throw new Error("Missing historical quote volume");
    return volume;
  }) };
}
