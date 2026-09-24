import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startDashboard, stopDashboard } from "../src/dashboard.js";
import type { PostgresPersistence } from "../src/persistence.js";

describe("dashboard authentication", () => {
  let server: Awaited<ReturnType<typeof startDashboard>> | undefined;
  const networkTest = process.env.CI ? it : it.skip;

  afterEach(async () => stopDashboard(server));

  networkTest("keeps data private and creates an authenticated session", async () => {
    const persistence = {
      getDashboardData: async () => ({ paused: false }),
    } as unknown as PostgresPersistence;
    server = await startDashboard({
      port: 0,
      host: "127.0.0.1",
      password: "correct-password",
      sessionSecret: "s".repeat(32),
      persistence,
      supportedSymbols: ["BTC/USDT"],
      onSettingsChanged: () => undefined,
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
  });
});
