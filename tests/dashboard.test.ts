import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startDashboard, stopDashboard } from "../src/dashboard.js";
import type { PostgresPersistence } from "../src/persistence.js";

describe("dashboard authentication", () => {
  let server: Awaited<ReturnType<typeof startDashboard>> | undefined;
  const networkTest = process.env.CI ? it : it.skip;

  afterEach(async () => stopDashboard(server));

  networkTest("confirms the cookie without waiting for exchange diagnostics and serves a fast snapshot", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const inspectDemoPositions = vi.fn(async () => { await gate; return { status: 'safe' as const, positions: [] }; });
    const inspectDemoAccounting = vi.fn(async () => { await gate; return { status: 'confirmed' }; });
    const persistence = { getDashboardData: async () => ({ paused: true }), latestDemoDecision: async () => null, latestDemoReconciliation: async () => null } as unknown as PostgresPersistence;
    server = await startDashboard({ port: 0, host: '127.0.0.1', password: 'password', sessionSecret: 's'.repeat(32), persistence, supportedSymbols: [], onSettingsChanged() {}, inspectDemoPositions, inspectDemoAccounting });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/api/session`)).status).toBe(401);
      expect((await fetch(`${base}/api/login`, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ password: 'password' }) })).status).toBe(403);
      const login = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ password: 'password' }) });
      const headers = { cookie: login.headers.get('set-cookie')!.split(';')[0]! };
      expect(login.headers.get('set-cookie')).toContain('SameSite=Lax');
      const session = await fetch(`${base}/api/session`, { headers, signal: AbortSignal.timeout(1500) });
      expect(await session.json()).toMatchObject({ authenticated: true });
      expect(inspectDemoPositions).not.toHaveBeenCalled();
      const snapshot = await fetch(`${base}/api/dashboard?fast=1`, { headers, signal: AbortSignal.timeout(1500) });
      expect(snapshot.status).toBe(200);
      expect(await snapshot.json()).toMatchObject({ paused: true, diagnostics: { positions: { refreshing: true }, accounting: { refreshing: true } } });
      await fetch(`${base}/api/dashboard?fast=1`, { headers, signal: AbortSignal.timeout(1500) });
      expect(inspectDemoPositions).toHaveBeenCalledTimes(1);expect(inspectDemoAccounting).toHaveBeenCalledTimes(1);
    } finally { release(); }
  });

  networkTest("acknowledges resume immediately, preserves safety blockers and lets a pause cancel pending checks", async () => {
    let paused = true, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const persistence = { setPaused: vi.fn(async (value: boolean) => { paused = value; return true; }), readControlState: async () => ({ paused, pauseReason: null }) } as unknown as PostgresPersistence;
    const onResume = vi.fn(async (signal?: AbortSignal) => { await gate; if (signal?.aborted) return { status: 'blocked' as const, reason: 'resume_cancelled' }; paused = false; return { status: 'resumed' as const }; });
    server = await startDashboard({ port: 0, host: '127.0.0.1', password: 'password', sessionSecret: 's'.repeat(32), persistence, supportedSymbols: [], onSettingsChanged() {}, onResume });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ password: 'password' }) });
    const headers = { cookie: login.headers.get('set-cookie')!.split(';')[0]!, origin: base };
    const send = (value: boolean) => fetch(`${base}/api/control?async=1`, { method: 'POST', headers, body: JSON.stringify({ paused: value }), signal: AbortSignal.timeout(1500) });
    try {
      const pending = await send(false);expect(pending.status).toBe(202);expect(await pending.json()).toMatchObject({ paused: true, job: { status: 'pending' } });
      expect((await send(false)).status).toBe(202);expect(onResume).toHaveBeenCalledTimes(1);
      expect(await (await fetch(`${base}/api/control-status`, { headers })).json()).toMatchObject({ paused: true, job: { status: 'pending' } });
      expect((await send(true)).status).toBe(200);expect(paused).toBe(true);
      release();await vi.waitFor(async () => expect(await (await fetch(`${base}/api/control-status`, { headers })).json()).toMatchObject({ paused: true, job: { status: 'cancelled' } }));
      onResume.mockImplementationOnce(async () => ({ status: 'blocked', reason: 'pending_demo_order' }));
      expect((await send(false)).status).toBe(202);
      await vi.waitFor(async () => expect(await (await fetch(`${base}/api/control-status`, { headers })).json()).toMatchObject({ paused: true, job: { status: 'blocked', reason: 'pending_demo_order' } }));
      expect((await send(false)).status).toBe(202);
      await vi.waitFor(async () => expect(await (await fetch(`${base}/api/control-status`, { headers })).json()).toMatchObject({ paused: false, job: { status: 'completed' } }));
    } finally { release(); }
  });

  networkTest("reports resume phase and exact attribution, and a manual pause clears the previous blocker", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let paused = true;
    const persistence = { setPaused: async (value: boolean) => { paused = value; return true; }, readControlState: async () => ({ paused, pauseReason: null }) } as unknown as PostgresPersistence;
    server = await startDashboard({ port: 0, host: '127.0.0.1', password: 'password', sessionSecret: 's'.repeat(32), persistence, supportedSymbols: [], onSettingsChanged() {},
      onResume: async (_signal, progress) => { progress?.('checking_accounting'); await gate; return { status: 'blocked', reason: 'demo_bot_risk_attribution_unconfirmed', attributionReason: 'position_balance_missing', balanceEvidence: { asset: 'SOL', expected: .5, actual: null, source: 'bot_position' } }; } });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ password: 'password' }) });
    const headers = { cookie: login.headers.get('set-cookie')!.split(';')[0]!, origin: base };
    try {
      expect((await fetch(`${base}/api/control?async=1`, { method: 'POST', headers, body: JSON.stringify({ paused: false }) })).status).toBe(202);
      const status = async () => (await fetch(`${base}/api/control-status`, { headers })).json();
      expect(await status()).toMatchObject({ paused: true, job: { phase: 'checking_accounting', status: 'pending' } });
      release();await vi.waitFor(async () => expect(await status()).toMatchObject({ paused: true, job: { status: 'blocked', attributionReason: 'position_balance_missing', balanceEvidence: { asset: 'SOL', expected: .5, actual: null } } }));
      await fetch(`${base}/api/control?async=1`, { method: 'POST', headers, body: JSON.stringify({ paused: true }) });
      expect(await status()).toMatchObject({ paused: true, job: null });
    } finally { release(); }
  });

  networkTest("ends an overlong check safely and never reports its late result as a successful resume", async () => {
    let release!: () => void, paused = true;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const setPaused = vi.fn(async (value: boolean) => { paused = value; return true; });
    const persistence = { setPaused, readControlState: async () => ({ paused, pauseReason: null }) } as unknown as PostgresPersistence;
    server = await startDashboard({ port: 0, host: '127.0.0.1', password: 'password', sessionSecret: 's'.repeat(32), persistence, supportedSymbols: [], onSettingsChanged() {}, resumeCheckTimeoutMs: 100,
      onResume: async signal => { await gate; if (!signal?.aborted) { paused = false; return { status: 'resumed' }; } return { status: 'blocked', reason: 'resume_cancelled' }; } });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ password: 'password' }) });
    const headers = { cookie: login.headers.get('set-cookie')!.split(';')[0]!, origin: base };
    try {
      expect((await fetch(`${base}/api/control?async=1`, { method: 'POST', headers, body: JSON.stringify({ paused: false }) })).status).toBe(202);
      const status = async () => (await fetch(`${base}/api/control-status`, { headers })).json();
      await vi.waitFor(async () => expect(await status()).toMatchObject({ paused: true, job: { status: 'failed', phase: 'timeout', reason: 'resume_check_timeout' } }));
      expect(setPaused).toHaveBeenCalledWith(true, 'dashboard');
      release();await new Promise(resolve => setTimeout(resolve, 5));
      expect(await status()).toMatchObject({ paused: true, job: { status: 'failed', reason: 'resume_check_timeout' } });
    } finally { release(); }
  });

  networkTest("exports complete UTF-8 JSON and TXT with matching byte length", async () => {
    const content = JSON.stringify({ generatedAt: "2026-11-02T17:48:40Z", scope: { hours: 24 }, records: [{ details: "Proteção e ação" }] }, null, 2);
    const persistence = { getDiagnosticLogs: vi.fn(async () => content) } as unknown as PostgresPersistence;
    server = await startDashboard({ port: 0, host: "127.0.0.1", password: "password", sessionSecret: "s".repeat(32), persistence, supportedSymbols: [], onSettingsChanged: () => undefined });
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/api/logs`)).status).toBe(401);
    const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    for (const format of ["json", "txt"]) {
      const response = await fetch(`${base}/api/logs?hours=24&format=${format}`, { headers: { cookie } });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toContain(`.${format}`);
      expect(Number(response.headers.get("content-length"))).toBe(Buffer.byteLength(content));
      expect(await response.text()).toBe(content);
    }
  });

  networkTest("protects runtime fidelity and includes it in diagnostic exports without relabeling records", async () => {
    const content = { generatedAt: "2026-11-19T00:00:00Z", records: [{ section: "paper_trades", trade: { type: "CLOSED" } }] };
    const getExecutionFidelity = vi.fn(async () => ({ status: "equivalence_not_established", snapshot: { configurationHash: "a".repeat(64) } }));
    server = await startDashboard({ port: 0, host: "127.0.0.1", password: "password", sessionSecret: "s".repeat(32),
      persistence: { getDiagnosticLogs: async () => JSON.stringify(content) } as unknown as PostgresPersistence,
      supportedSymbols: [], onSettingsChanged: () => undefined, getExecutionFidelity });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/api/execution-fidelity`)).status).toBe(401);
    expect(getExecutionFidelity).not.toHaveBeenCalled();
    const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "password" }) });
    const headers = { cookie: login.headers.get("set-cookie")!.split(";")[0]! };
    expect(await (await fetch(`${base}/api/execution-fidelity`, { headers })).json()).toHaveProperty("status", "equivalence_not_established");
    const response = await fetch(`${base}/api/logs`, { headers });
    const text = await response.text();
    expect(Number(response.headers.get("content-length"))).toBe(Buffer.byteLength(text));
    const parsed = JSON.parse(text);
    expect(parsed.records).toEqual(content.records);
    expect(parsed.executionFidelity.snapshot.configurationHash).toBe("a".repeat(64));
  });

  networkTest("starts a Demo cycle only for an authenticated same-origin request with the current marker", async () => {
    const started = "2026-11-18T00:00:00.001Z";
    const startDemoCycle = vi.fn().mockResolvedValueOnce(started).mockResolvedValueOnce(null);
    const persistence = { startDemoCycle } as unknown as PostgresPersistence;
    server = await startDashboard({ port: 0, host: "127.0.0.1", password: "password", sessionSecret: "s".repeat(32),
      persistence, supportedSymbols: [], onSettingsChanged: () => undefined });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = (cookie = "", origin = base, body: unknown = { expectedStart: null }) =>
      fetch(`${base}/api/demo-cycle`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await call()).status).toBe(401);
    const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect((await call(cookie, "https://other.invalid")).status).toBe(403);
    expect((await call(cookie, base, {})).status).toBe(400);
    expect(await (await call(cookie)).json()).toEqual({ cycleStartedAt: started });
    expect((await call(cookie)).status).toBe(409);
    expect(startDemoCycle.mock.calls).toEqual([[null], [null]]);
  });

  networkTest("applies a later pause after an in-flight resume", async () => {
    let paused = true;
    const operations: string[] = [];
    let resumeStarted!: () => void;
    let releaseResume!: () => void;
    const started = new Promise<void>((resolve) => { resumeStarted = resolve; });
    const gate = new Promise<void>((resolve) => { releaseResume = resolve; });
    const persistence = { setPaused: vi.fn(async (value: boolean) => { paused = value; operations.push(value ? "pause" : "resume"); }) } as unknown as PostgresPersistence;
    server = await startDashboard({ port: 0, host: "127.0.0.1", password: "password", sessionSecret: "s".repeat(32), persistence, supportedSymbols: [], onSettingsChanged: () => undefined,
      onResume: async () => { resumeStarted(); await gate; await persistence.setPaused(false, "dashboard"); return { status: "resumed" }; } });
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const control = (value: boolean) => fetch(`${base}/api/control`, { method: "POST", headers: { cookie, origin: base, "content-type": "application/json" }, body: JSON.stringify({ paused: value }) });
    const resume = control(false);
    await started;
    const pause = control(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(operations).toEqual([]);
    releaseResume();
    expect((await resume).status).toBe(200);
    expect((await pause).status).toBe(200);
    expect(operations).toEqual(["resume", "pause"]);
    expect(paused).toBe(true);
  });

  networkTest("keeps data private and creates an authenticated session", async () => {
    const onSettingsChanged = vi.fn();
    const onResume = vi.fn().mockResolvedValueOnce({ status: "blocked", reason: "pending_demo_order" }).mockResolvedValueOnce({ status: "resumed" });
    const inspectDemoAccounting = vi.fn(async () => ({ status: "unavailable", reason: "no_confirmed_orders" }));
    const persistence = {
      getDashboardData: vi.fn(async () => ({ paused: false })),
      latestDemoDecision: async () => null,
      latestDemoReconciliation: async () => ({ confirmedThrough: "2026-11-01T12:00:00.000Z", realizedPnlUsdt: 12.85 }),
      updateDashboardSettings: vi.fn(async () => undefined),
    } as unknown as PostgresPersistence;
    server = await startDashboard({
      port: 0,
      host: "127.0.0.1",
      password: "correct-password",
      sessionSecret: "s".repeat(32),
      persistence,
      supportedSymbols: ["BTC/USDT"],
      onSettingsChanged,
      onResume,
      inspectDemoAccounting,
      getAutoResumeStatus: async () => ({ enabled: false, eligibleAt: null }),
      paperDefaultTradeSize: 100,
      inspectDemoPermission: async () => ({ status: "available", trading: true }),
    });
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    expect((await fetch(`${base}/api/dashboard`)).status).toBe(401);
    expect((await fetch(`${base}/api/demo-permission`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: "wrong" }),
        })
      ).status,
    ).toBe(401);

    const login = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "correct-password" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");

    const authenticated = await fetch(`${base}/api/dashboard`, {
      headers: { cookie: cookie!.split(";")[0]! },
    });
    expect(authenticated.status).toBe(200);
    const dashboardData = await authenticated.json();
    expect(dashboardData.autoResume).toEqual({ enabled: false, eligibleAt: null });
    expect(dashboardData.paperDefaultTradeSize).toBe(100);
    const headers = { cookie: cookie!.split(";")[0]! };
    expect((await fetch(`${base}/api/dashboard?paperSince=2026-11-17`, { headers })).status).toBe(200);
    expect(persistence.getDashboardData).toHaveBeenLastCalledWith(40, undefined, Date.parse("2026-11-17"));
    expect((await fetch(`${base}/api/dashboard?paperSince=2026-02-30`, { headers })).status).toBe(400);
    expect(dashboardData.lastDemoReconciliation.confirmedThrough).toBe("2026-11-01T12:00:00.000Z");
    expect(dashboardData.demoAccounting).toEqual({ status: "unavailable", reason: "no_confirmed_orders" });
    const reconciliation = await fetch(`${base}/api/demo-reconciliation`, { headers: { cookie: cookie!.split(";")[0]! } });
    expect(await reconciliation.json()).toEqual({ status: "unavailable", reason: "no_confirmed_orders" });
    expect(inspectDemoAccounting).toHaveBeenCalledOnce();
    const permission = await fetch(`${base}/api/demo-permission`, { headers: { cookie: cookie!.split(";")[0]! } });
    expect(await permission.json()).toEqual({ status: "available", trading: true });

    const settings = await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: {
        cookie: cookie!.split(";")[0]!,
        origin: base,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        symbol: "BTC/USDT",
        orderSizeUsdt: 10,
        paperTradeSizeUsdt: 10,
        maxTrades: 50,
        intervalMinutes: 15,
        maxConcurrentPositions: 50,
      }),
    });
    expect(settings.status).toBe(202);
    expect(persistence.updateDashboardSettings).toHaveBeenCalledWith(expect.objectContaining({ paperTradeSizeUsdt: 10, maxTrades: 50, maxConcurrentPositions: 50, intervalMinutes: 15 }), "dashboard");
    const submitted = await settings.json() as { revision: number };
    const status = await fetch(`${base}/api/settings-status`, { headers: { cookie: cookie!.split(";")[0]! } });
    expect(await status.json()).toEqual({ revision: submitted.revision, status: "applied" });
    expect(onSettingsChanged).toHaveBeenCalledOnce();
    for (const invalid of [{ maxTrades: 51 }, { maxConcurrentPositions: 51 }, { paperTradeSizeUsdt: 101 }]) {
      const result = await fetch(`${base}/api/settings`, {
        method: "PUT", headers: { cookie: cookie!.split(";")[0]!, origin: base, "content-type": "application/json" },
        body: JSON.stringify({ symbol: "BTC/USDT", orderSizeUsdt: 10, maxTrades: 50, intervalMinutes: 15, maxConcurrentPositions: 50, ...invalid }),
      });
      expect(result.status).toBe(400);
    }
    const control = () => fetch(`${base}/api/control`, { method: "POST", headers: { cookie: cookie!.split(";")[0]!, origin: base, "content-type": "application/json" }, body: JSON.stringify({ paused: false }) });
    const blocked = await control();
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ reason: "pending_demo_order" });
    expect((await control()).status).toBe(200);
    onSettingsChanged.mockRejectedValueOnce(new Error("reconfigure failed"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failedSettings = await fetch(`${base}/api/settings`, {
      method: "PUT", headers: { cookie: cookie!.split(";")[0]!, origin: base, "content-type": "application/json" },
      body: JSON.stringify({ symbol: "BTC/USDT", orderSizeUsdt: 10, maxTrades: 1, intervalMinutes: 60, maxConcurrentPositions: 2 }),
    });
    expect(failedSettings.status).toBe(202);
    const failedStatus = await fetch(`${base}/api/settings-status`, { headers: { cookie: cookie!.split(";")[0]! } });
    expect(await failedStatus.json()).toMatchObject({ status: "failed" });
    log.mockRestore();
  });
});

