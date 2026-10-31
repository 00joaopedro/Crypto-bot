/** OKX /api/v5/account/config identifies the authenticated main or sub-account.
 * UID is an account identifier, not an API key, and is never included in UI output.
 */
export type DemoAccountIdentity = { uid: string; mainUid: string };

export function readDemoAccountIdentity(response: unknown): DemoAccountIdentity | null {
  if (!response || typeof response !== "object") return null;
  const payload = response as { code?: unknown; data?: unknown };
  if (payload.code !== "0" || !Array.isArray(payload.data) || payload.data.length !== 1) return null;
  const item = payload.data[0] as Record<string, unknown> | null;
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  if (typeof item.uid !== "string" || !/^\d+$/.test(item.uid) || typeof item.mainUid !== "string" || !/^\d+$/.test(item.mainUid)) return null;
  return { uid: item.uid, mainUid: item.mainUid };
}

export function sameDemoAccount(saved: unknown, current: DemoAccountIdentity): boolean {
  if (!saved || typeof saved !== "object") return false;
  const record = saved as Record<string, unknown>;
  return record.uid === current.uid && record.mainUid === current.mainUid;
}
