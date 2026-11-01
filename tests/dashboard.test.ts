import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startDashboard, stopDashboard } from "../src/dashboard.js";
import type { PostgresPersistence } from "../src/persistence.js";

describe("dashboard authentication", () => {
  let server: Awaited<ReturnType<typeof startDashboard>> | undefined;
  const networkTest = process.env.CI ? it : it.skip;

  afterEach(async () => stopDashboard(server));

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
      getDashboardData: async () => ({ paused: false }),
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
        maxTrades: 1,
        intervalMinutes: 60,
        maxConcurrentPositions: 2,
      }),
    });
    expect(settings.status).toBe(202);
    const submitted = await settings.json() as { revision: number };
    const status = await fetch(`${base}/api/settings-status`, { headers: { cookie: cookie!.split(";")[0]! } });
    expect(await status.json()).toEqual({ revision: submitted.revision, status: "applied" });
    expect(onSettingsChanged).toHaveBeenCalledOnce();
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

