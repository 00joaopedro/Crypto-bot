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
});
