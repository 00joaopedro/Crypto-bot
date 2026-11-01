type BillsClient = { privateGetAccountBills(params: Record<string, string>): Promise<unknown> };

/** Checks for account bills during the baseline snapshot window. An empty
 * response is an observation, not proof of global history or API completeness. */
export async function inspectBaselineBills(client: BillsClient, input: { from: number; to: number; now: number; maxPages?: number }): Promise<{ status: "observed"; activity: boolean } | { status: "unavailable"; reason: string }> {
  const { from, to, now } = input;
  const maxPages = input.maxPages ?? 100;
  if (![from, to, now].every(Number.isSafeInteger) || from <= 0 || from > to || to > now || from < now - 6 * 86_400_000 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000) return { status: "unavailable", reason: "baseline_history_window_unsupported" };
  try {
    let cursor: bigint | undefined;
    let activity = false;
    for (let page = 0; page < maxPages; page++) {
      const params: Record<string, string> = { begin: String(from - 1), end: String(to + 1), limit: "100" };
      if (cursor !== undefined) params.after = String(cursor);
      const response = await client.privateGetAccountBills(params) as { code?: unknown; data?: unknown } | null;
      if (!response || response.code !== "0" || !Array.isArray(response.data) || response.data.length > 100) return { status: "unavailable", reason: "invalid_baseline_history_response" };
      if (response.data.length === 0) return { status: "observed", activity };
      activity = true;
      for (const item of response.data) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return { status: "unavailable", reason: "invalid_baseline_history_record" };
        const row = item as Record<string, unknown>;
        if (typeof row.ts !== "string" || !/^\d+$/.test(row.ts) || typeof row.billId !== "string" || !/^\d+$/.test(row.billId)) return { status: "unavailable", reason: "invalid_baseline_history_record" };
        const billId = BigInt(row.billId);
        if (cursor !== undefined && billId >= cursor) return { status: "unavailable", reason: "non_monotonic_baseline_bills" };
        cursor = billId;
        const timestamp = Number(row.ts);
        if (!Number.isSafeInteger(timestamp) || timestamp < from || timestamp > to) return { status: "unavailable", reason: "baseline_history_outside_window" };
      }
    }
    return { status: "unavailable", reason: "baseline_history_page_limit" };
  } catch { return { status: "unavailable", reason: "baseline_history_request_failed" }; }
}
