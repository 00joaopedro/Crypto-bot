import { createHmac, timingSafeEqual } from 'node:crypto';
export const SESSION_MS = 12 * 60 * 60_000;
export function createSessionCookie(secret: string, now = Date.now()): string {
  const payload = String(now + SESSION_MS);
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `bot_session=${payload}.${signature}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=43200`;
}
export function sessionExpires(cookie: string | undefined, secret: string, now = Date.now()): number | null {
  const value = cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('bot_session='))?.slice(12);
  if (!value || !/^\d{13}\.[a-f0-9]{64}$/.test(value)) return null;
  const [payload, signature] = value.split('.') as [string,string];
  const expires = Number(payload);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + SESSION_MS + 10_000) return null;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? expires : null;
}
