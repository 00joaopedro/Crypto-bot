import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

describe("configuration", () => {
  it("defaults to 10 positions and 10 Demo orders, and caps each independently at 50", () => {
    expect(parseConfig({})).toMatchObject({ MAX_CONCURRENT_POSITIONS: 10, RISK_MAX_TRADES_PER_HOUR: 10 });
    expect(parseConfig({ MAX_CONCURRENT_POSITIONS: "50", RISK_MAX_TRADES_PER_HOUR: "5" }))
      .toMatchObject({ MAX_CONCURRENT_POSITIONS: 50, RISK_MAX_TRADES_PER_HOUR: 5 });
    expect(parseConfig({ RISK_MAX_TRADES_PER_HOUR: "50" }).RISK_MAX_TRADES_PER_HOUR).toBe(50);
    expect(() => parseConfig({ MAX_CONCURRENT_POSITIONS: "51" })).toThrow();
    expect(() => parseConfig({ RISK_MAX_TRADES_PER_HOUR: "51" })).toThrow();
  });
  it("keeps managed exits, trailing and breakeven disabled until explicitly configured", () => {
    const config = parseConfig({});
    expect(config.EXIT_MANAGEMENT_ENABLED).toBe(false);
    expect(config.EXIT_MODE).toBe("fixed");
    expect(config.EXIT_BREAKEVEN_ENABLED).toBe(false);
    expect(() => parseConfig({ EXIT_MODE: "unvalidated" })).toThrow();
  });
  it("treats an empty DATABASE_URL from .env as disabled persistence", () => {
    const parsed = parseConfig({ DATABASE_URL: "" });

    expect(parsed.DATABASE_URL).toBeUndefined();
    expect(parsed.ENVIRONMENT).toBe("LOG_ONLY");
  });

  it("trims a configured DATABASE_URL", () => {
    const parsed = parseConfig({
      DATABASE_URL: "  postgresql://user:pass@postgres:5432/crypto_bot  ",
    });

    expect(parsed.DATABASE_URL).toBe(
      "postgresql://user:pass@postgres:5432/crypto_bot",
    );
  });

  it("requires a strong session secret when the dashboard is enabled", () => {
    expect(() =>
      parseConfig({
        DASHBOARD_PASSWORD: "test-password",
        DASHBOARD_SESSION_SECRET: "short",
      }),
    ).toThrow();

    expect(
      parseConfig({
        DASHBOARD_PASSWORD: "test-password",
        DASHBOARD_SESSION_SECRET: "a".repeat(32),
      }).DASHBOARD_PASSWORD,
    ).toBe("test-password");
  });
});

it("requires explicit opt-in for auto resume and a positive Demo budget", () => {
  const defaults = parseConfig({});
  expect(defaults.AUTO_RESUME_ENABLED).toBe(false);
  expect(defaults.AUTO_RESUME_LOSS_COOLDOWN_MINUTES).toBe(120);
  expect(defaults.OKX_DEMO_BOT_BUDGET_USDT).toBeUndefined();
  expect(parseConfig({ AUTO_RESUME_ENABLED: "true", OKX_DEMO_BOT_BUDGET_USDT: "5000" }))
    .toMatchObject({ AUTO_RESUME_ENABLED: true, OKX_DEMO_BOT_BUDGET_USDT: 5000 });
  expect(() => parseConfig({ OKX_DEMO_BOT_BUDGET_USDT: "0" })).toThrow();
});

it("supports a bounded or all-eligible universe with conservative scheduling defaults", () => {
  expect(parseConfig({})).toMatchObject({ DYNAMIC_UNIVERSE_SIZE: 10, SIGNAL_SCAN_CONCURRENCY: 2, SIGNAL_SCAN_REQUEST_BUDGET: 20, SIGNAL_SCAN_TIME_BUDGET_MS: 10000 });
  for (const value of ["0", "100", "200", "1000"]) expect(parseConfig({ DYNAMIC_UNIVERSE_SIZE: value }).DYNAMIC_UNIVERSE_SIZE).toBe(Number(value));
  for (const value of ["-1", "1001", "1.5"]) expect(() => parseConfig({ DYNAMIC_UNIVERSE_SIZE: value })).toThrow();
  expect(() => parseConfig({ SIGNAL_SCAN_CONCURRENCY: "5" })).toThrow();
  expect(() => parseConfig({ SIGNAL_SCAN_REQUEST_BUDGET: "0" })).toThrow();
  expect(() => parseConfig({ SIGNAL_SCAN_TIME_BUDGET_MS: "999" })).toThrow();
});
