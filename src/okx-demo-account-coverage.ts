/** Complete, bounded scan of account balance-changing bills since a Demo baseline.
 * This proves only coverage of the supported window, not snapshot atomicity.
 */
async function scanCoverage(
  client: { privateGetAccountBills(params: Record<string, string>): Promise<unknown> },
  input: { from: number; to: number; now: number; ownedOrderIds: ReadonlySet<string>; quiescentFrom?: number; maxPages?: number },
): Promise<{ status: "covered"; billCount: number } | { status: "unavailable"; reason: string }> {
  const unavailable = (reason: string) => ({ status: "unavailable" as const, reason });
  const maxPages = input.maxPages ?? 100;
  if (![input.from, input.to, input.now].every(Number.isSafeInteger) || input.from <= 0 || input.from > input.to || input.to > input.now || input.from < input.now - 80 * 86_400_000 || (input.quiescentFrom !== undefined && (!Number.isSafeInteger(input.quiescentFrom) || input.quiescentFrom < input.from || input.quiescentFrom > input.to)) || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000) return unavailable("account_coverage_window_unsupported");
  let cursor: bigint | undefined;
  let count = 0;
  try {
    for (let page = 0; page < maxPages; page++) {
      const params: Record<string, string> = { begin: String(input.from), end: String(input.to), limit: "100" };
      if (cursor !== undefined) params.after = String(cursor);
      const response = await client.privateGetAccountBills(params) as { code?: unknown; data?: unknown } | null;
      if (!response || response.code !== "0" || !Array.isArray(response.data) || response.data.length > 100) return unavailable("account_bills_response_invalid");
      if (!response.data.length) return { status: "covered", billCount: count };
      for (const item of response.data) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return unavailable("account_bill_invalid");
        const row = item as Record<string, unknown>;
        if (typeof row.billId !== "string" || !/^\d+$/.test(row.billId) || typeof row.ts !== "string" || !/^\d+$/.test(row.ts)) return unavailable("account_bill_invalid");
        const id = BigInt(row.billId);
        if (cursor !== undefined && id >= cursor) return unavailable("account_bills_cursor_invalid");
        cursor = id;
        const timestamp = Number(row.ts);
        if (!Number.isSafeInteger(timestamp) || timestamp < input.from || timestamp > input.to) return unavailable("account_bill_outside_window");
        if (input.quiescentFrom !== undefined && timestamp >= input.quiescentFrom) return unavailable("account_movement_during_snapshot");
        // Account movements without a verified bot order may be transfers,
        // manual orders, or adjustments. Any of them breaks isolated P&L.
        if (typeof row.ordId !== "string" || !input.ownedOrderIds.has(row.ordId)) return unavailable("unattributed_account_bill");
        count++;
      }
    }
    return unavailable("account_bills_page_limit");
  } catch { return unavailable("account_bills_request_failed"); }
}

/** Historical and recent account bills cover adjacent, non-overlapping windows. */
export async function collectDemoAccountCoverage(
  client: { privateGetAccountBills(params: Record<string, string>): Promise<unknown>; privateGetAccountBillsHistory?: (params: Record<string, string>) => Promise<unknown> },
  input: { from: number; to: number; now: number; ownedOrderIds: ReadonlySet<string>; quiescentFrom?: number; maxPages?: number },
): Promise<{ status: "covered"; billCount: number } | { status: "unavailable"; reason: string }> {
  const boundary = input.now - 6 * 86_400_000;
  if (input.from >= boundary) return scanCoverage(client, input);
  if (!client.privateGetAccountBillsHistory) return { status: "unavailable", reason: "account_coverage_window_unsupported" };
  // Validate the entire request before issuing either half.
  if (![input.from, input.to, input.now].every(Number.isSafeInteger) || input.from <= 0 || input.from > input.to || input.to > input.now || input.from < input.now - 80 * 86_400_000 || (input.quiescentFrom !== undefined && (input.quiescentFrom < input.from || input.quiescentFrom > input.to))) return { status: "unavailable", reason: "account_coverage_window_unsupported" };
  const oldTo = Math.min(input.to, boundary - 1);
  const older = await scanCoverage({ privateGetAccountBills: params => client.privateGetAccountBillsHistory!(params) }, {
    ...input, to: oldTo, ...(input.quiescentFrom !== undefined && input.quiescentFrom > oldTo ? { quiescentFrom: undefined } : {}),
  } as typeof input);
  if (older.status !== "covered" || input.to < boundary) return older;
  const recent = await scanCoverage(client, { ...input, from: boundary, ...(input.quiescentFrom !== undefined && input.quiescentFrom < boundary ? { quiescentFrom: boundary } : {}) });
  return recent.status === "covered" ? { status: "covered", billCount: older.billCount + recent.billCount } : recent;
}
