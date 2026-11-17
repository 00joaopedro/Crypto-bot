import { afterEach, expect, it, vi } from "vitest";
import { EmailTradeAlert } from "../src/email-alerts.js";
import type { PaperTradeClosed } from "../src/paper-trader.js";

const trade = { entryPrice: 100, exitPrice: 99, quantity: 1, feesUsdt: 0.2, netPnlUsdt: -1.2, netPnlPercent: -1.2 } as PaperTradeClosed;
afterEach(() => vi.unstubAllGlobals());

it("reports only the HTTP status and a recognized Resend error category", async () => {
  const fetchMock = vi.fn(async () => Response.json({ name: "validation_error", message: "private@example.com" }, { status: 422 }));
  vi.stubGlobal("fetch", fetchMock);
  const alert = new EmailTradeAlert({ apiKey: "test", from: "Crypto Bot <alerts@example.com>", to: "private@example.com" });
  await expect(alert.sendClosed("ETH/USDT", trade)).rejects.toThrow(/^Email provider returned HTTP 422 \(validation_error\)$/);
});

it("rejects a malformed recipient before contacting Resend", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const alert = new EmailTradeAlert({ apiKey: "test", from: "alerts@example.com", to: "invalid" });
  await expect(alert.sendClosed("ETH/USDT", trade)).rejects.toThrow("Invalid EMAIL_ALERT_TO format");
  expect(fetchMock).not.toHaveBeenCalled();
});
