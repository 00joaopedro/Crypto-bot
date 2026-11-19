import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startDashboard, stopDashboard } from "../src/dashboard.js";
import type { PostgresPersistence } from "../src/persistence.js";

describe("dashboard authentication", () => {
  let server: Awaited<ReturnType<typeof startDashboard>> | undefined;
  const networkTest = process.env.CI ? it : it.skip;

  afterEach(async () => stopDashboard(server));

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

