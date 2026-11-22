import { describe, expect, it } from 'vitest';
import { createSessionCookie, sessionExpires, SESSION_MS } from '../src/dashboard-session.js';

describe('dashboard session', () => {
  const now = Date.parse('2026-11-22T00:00:00Z'), secret = 'a'.repeat(32);
  it('remains valid after leaving the page, reloads and process restarts with the same secret', () => {
    const cookie = createSessionCookie(secret, now);
    for (const elapsed of [0, 5000, 60_000, SESSION_MS - 1]) expect(sessionExpires(cookie, secret, now + elapsed)).toBe(now + SESSION_MS);
    expect(sessionExpires(cookie, secret, now + SESSION_MS)).toBeNull();
    expect(cookie).toContain('HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=43200');
  });
  it('rejects tampering, malformed credentials and a changed signing secret', () => {
    const cookie = createSessionCookie(secret, now);
    expect(sessionExpires(cookie, 'b'.repeat(32), now)).toBeNull();
    expect(sessionExpires(cookie.replace(String(now + SESSION_MS), String(now + SESSION_MS + 1)), secret, now)).toBeNull();
    for (const invalid of [undefined, '', 'bot_session=invalid', 'bot_session=123.abc', 'not_bot_session='+cookie]) expect(sessionExpires(invalid, secret, now)).toBeNull();
    expect(sessionExpires('other=value; '+cookie, secret, now)).toBe(now + SESSION_MS);
  });
});
