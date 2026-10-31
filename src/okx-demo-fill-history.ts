import type { DemoFill } from "./demo-ledger.js";

// OKX paginates these endpoints by billId, not tradeId or timestamp. These
// methods must be supplied by the *already sandbox-initialized* OKX executor.
export type OkxFillHistoryClient = {
  privateGetTradeFills(params: Record<string, string>): Promise<unknown>;
  privateGetTradeFillsHistory(params: Record<string, string>): Promise<unknown>;
};

export type OkxCollectedFills =
  | { status: "unavailable"; reason: string }
  | { status: "collected"; fills: DemoFill[]; from: number; to: number };

/** Collects exchange data only. This does not prove bot ownership, protection
 * order linkage, account consistency, or ledger coverage. The caller must not
 * treat `collected` as evidence that it is safe to publish a P&L.
 */
export async function collectOkxDemoFills(
  client: OkxFillHistoryClient,
  input: { symbol: string; from: number; to: number; now: number; maxPages?: number },
): Promise<OkxCollectedFills> {
  const unavailable = (reason: string): OkxCollectedFills => ({ status: "unavailable", reason });
  const match = /^([A-Z0-9]+)\/USDT$/.exec(input.symbol);
  const day = 86_400_000;
  const maxPages = input.maxPages ?? 100;
  if (!match || !Number.isSafeInteger(input.from) || !Number.isSafeInteger(input.to) || !Number.isSafeInteger(input.now) ||
      input.from < input.now - 80 * day || input.from < 0 || input.from > input.to || input.to > input.now ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000) return unavailable("invalid_or_unsupported_history_window");
  const instId = `${match[1]}-USDT`;
  // Use the recent endpoint inside its documented three-day retention, with a
  // one-day overlap against the historical endpoint to catch boundary records.
  const recentStart = input.now - 2 * day;
  const historicalEnd = input.now - day;
  const windows: Array<{ endpoint: "recent" | "history"; from: number; to: number }> = [];
  if (input.from <= historicalEnd) windows.push({ endpoint: "history", from: input.from, to: Math.min(input.to, historicalEnd) });
  if (input.to >= recentStart) windows.push({ endpoint: "recent", from: Math.max(input.from, recentStart), to: input.to });
  const result = new Map<string, { fill: DemoFill; signature: string }>();
  try {
    for (const window of windows) {
      let cursor: string | undefined;
      let done = false;
      for (let page = 0; page < maxPages; page++) {
        const params: Record<string, string> = { instType: "SPOT", instId, begin: String(window.from), end: String(window.to), limit: "100" };
        if (cursor) params.after = cursor;
        const response = window.endpoint === "recent" ? await client.privateGetTradeFills(params) : await client.privateGetTradeFillsHistory(params);
        const data = response as { code?: unknown; data?: unknown } | null;
        if (!data || data.code !== "0" || !Array.isArray(data.data) || data.data.length > 100) return unavailable("invalid_history_response");
        if (data.data.length === 0) { done = true; break; }
        let previous = cursor ? BigInt(cursor) : undefined;
        for (const item of data.data) {
          if (!item || typeof item !== "object") return unavailable("invalid_fill");
          const row = item as Record<string, unknown>;
          if (typeof row.billId !== "string" || !/^\d+$/.test(row.billId)) return unavailable("invalid_bill_id");
          const bill = BigInt(row.billId);
          if (previous !== undefined && bill >= previous) return unavailable("non_monotonic_pagination");
          previous = bill;
          const numeric = (v: unknown): number | null => typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
          const amount = numeric(row.fillSz), price = numeric(row.fillPx), fee = numeric(row.fee), timestamp = numeric(row.fillTime), generated = numeric(row.ts);
          if (row.instType !== "SPOT" || row.instId !== instId || typeof row.ordId !== "string" || !row.ordId ||
              (row.side !== "buy" && row.side !== "sell") || amount === null || amount <= 0 || price === null || price <= 0 ||
              fee === null || fee > 0 || typeof row.feeCcy !== "string" || !row.feeCcy || timestamp === null || !Number.isSafeInteger(timestamp) ||
              generated === null || !Number.isSafeInteger(generated) || generated < window.from || generated > window.to || !Number.isFinite(amount * price)) return unavailable("invalid_or_unsupported_fill");
          const fill: DemoFill = { id: row.billId, orderId: row.ordId, symbol: input.symbol, side: row.side, timestamp, amount, costUsdt: amount * price, fees: [{ currency: row.feeCcy, cost: -fee }] };
          const signature = JSON.stringify(fill);
          const existing = result.get(row.billId);
          if (existing && existing.signature !== signature) return unavailable("conflicting_fill_records");
          result.set(row.billId, { fill, signature });
        }
        cursor = (data.data[data.data.length - 1] as Record<string, string>).billId;
      }
      if (!done) return unavailable("history_page_limit_exceeded");
    }
    return { status: "collected", fills: [...result.values()].map(({ fill }) => fill), from: input.from, to: input.to };
  } catch {
    return unavailable("history_request_failed");
  }
}
