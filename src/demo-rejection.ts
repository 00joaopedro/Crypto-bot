/** Recognize only the structured, explicit OKX permission rejection. */
export function isExplicitDemoPermissionRejection(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const error = (result as Record<string, unknown>).error;
  if (typeof error !== "string" || !error.startsWith("okx ")) return false;
  try {
    const data = JSON.parse(error.slice(4)) as { code?: unknown; msg?: unknown };
    return data.code === "50123" && typeof data.msg === "string" && data.msg.includes("does not have trading permission");
  } catch { return false; }
}

/** A per-order business rejection, never a timeout or a batch-wide assumption. */
export function explicitDemoRejection(result: unknown, clientOrderId: string): { code: string; method: string } | null {
  if (isExplicitDemoPermissionRejection(result)) return { code: '50123', method: 'okx_50123_and_order_not_found' };
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const error = (result as { error?: unknown }).error;
  if (typeof error !== 'string' || !error.startsWith('okx ')) return null;
  try {
    const body = JSON.parse(error.slice(4));
    if (body.code !== '1' || !Array.isArray(body.data) || body.data.length !== 1) return null;
    const row = body.data[0];
    if (row.sCode !== '51155' || row.clOrdId !== clientOrderId || row.ordId !== '' ||
      typeof row.sMsg !== 'string' || !row.sMsg.includes('local compliance restrictions')) return null;
    return { code: '51155', method: 'okx_51155_exact_client_and_order_not_found' };
  } catch { return null; }
}
