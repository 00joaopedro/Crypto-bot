import { describe, expect, it, vi } from "vitest";
import type { Exchange } from "ccxt";
import { OkxDemoDiagnostics } from "../src/okx-demo.js";

describe("OkxDemoDiagnostics", () => {
  it("enables sandbox first and performs authenticated reads without orders", async () => {
    const calls: string[] = [];
    const exchange = {
      setSandboxMode: vi.fn(() => calls.push("sandbox")),
      loadMarkets: vi.fn(async () => {
        calls.push("markets");
        return {};
      }),
      market: vi.fn(() => ({
        symbol: "BTC/USDT",
        quote: "USDT",
        spot: true,
      })),
      fetchBalance: vi.fn(async () => {
        calls.push("balance");
        return { free: { USDT: 123.45 } };
      }),
      close: vi.fn(async () => undefined),
      createOrder: vi.fn(),
    } as unknown as Exchange;

    const diagnostics = new OkxDemoDiagnostics(
      { apiKey: "key", secretKey: "secret", passphrase: "passphrase" },
      "BTC/USDT",
      exchange,
    );

    await expect(diagnostics.initialize()).resolves.toEqual({
      provider: "okx-demo",
      authenticated: true,
      symbol: "BTC/USDT",
      quoteCurrency: "USDT",
      quoteFree: 123.45,
      orderExecutionEnabled: false,
    });
    expect(calls).toEqual(["sandbox", "markets", "balance"]);
    expect(exchange.createOrder).not.toHaveBeenCalled();
  });

  it("rejects non-Spot symbols before requesting the balance", async () => {
    const exchange = {
      setSandboxMode: vi.fn(),
      loadMarkets: vi.fn(async () => ({})),
      market: vi.fn(() => ({
        symbol: "BTC/USDT:USDT",
        quote: "USDT",
        spot: false,
      })),
      fetchBalance: vi.fn(),
      close: vi.fn(async () => undefined),
    } as unknown as Exchange;

    const diagnostics = new OkxDemoDiagnostics(
      { apiKey: "key", secretKey: "secret", passphrase: "passphrase" },
      "BTC/USDT:USDT",
      exchange,
    );

    await expect(diagnostics.initialize()).rejects.toThrow(
      "OKX Demo symbol must be a Spot market",
    );
    expect(exchange.fetchBalance).not.toHaveBeenCalled();
  });
});
