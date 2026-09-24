import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startDashboard, stopDashboard } from "../src/dashboard.js";
import type { PostgresPersistence } from "../src/persistence.js";

describe("dashboard authentication", () => {
  let server: Awaited<ReturnType<typeof startDashboard>> | undefined;
  const networkTest = process.env.CI ? it : it.skip;

  afterEach(async () => stopDashboard(server));

  networkTest("keeps data private and creates an authenticated session", async () => {
    const onSettingsChanged = vi.fn();
    const persistence = {
      getDashboardData: async () => ({ paused: false }),
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
    });
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    expect((await fetch(`${base}/api/dashboard`)).status).toBe(401);
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
      }),
    });
    expect(settings.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(onSettingsChanged).toHaveBeenCalledOnce();
  });
});
