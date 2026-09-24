import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

describe("configuration", () => {
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
