import ccxt, { OrderNotFound, type Exchange } from "ccxt";
import { describe, expect, it, vi } from "vitest";
import {
  createClientOrderId,
  classifyDemoOrder,
  normalizedOrderFees,
  OkxDemoExecutor,
  type OkxDemoOptions,
} from "../src/okx-demo.js";

const credentials = {
  apiKey: "key",
  secretKey: "secret",
  passphrase: "passphrase",
};

const enabledOptions: OkxDemoOptions = {
  symbol: "BTC/USDT",
  tradingEnabled: true,
  orderSizeUsdt: 10,
  stopLossRate: 0.01,
  takeProfitRate: 0.02,
};

function exchangeMock(overrides: Record<string, unknown> = {}): Exchange {
  return {
    setSandboxMode: vi.fn(),
    loadMarkets: vi.fn(async () => ({})),
    market: vi.fn(() => ({
      symbol: "BTC/USDT",
      quote: "USDT",
      spot: true,
      active: true,
      limits: { cost: { min: 1, max: undefined } },
    })),
    fetchBalance: vi.fn(async () => ({ free: { USDT: 5000 } })),
    fetchOrder: vi.fn(async () => {
      throw new OrderNotFound("missing");
    }),
    fetchOpenOrders: vi.fn(async () => []),
    fetchTicker: vi.fn(async () => ({ ask: 100 })),
    priceToPrecision: vi.fn((_symbol: string, value: number) => String(value)),
    createMarketBuyOrderWithCost: vi.fn(async () => ({
      id: "order-1",
      status: "closed",
      filled: 0.1,
      average: 100,
      cost: 10,
    })),
    close: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as Exchange;
}

describe("OkxDemoExecutor", () => {
  it("collects fills only with an initialized Demo exchange and never submits orders", async () => {
    const getFills = vi.fn(async () => ({ code: "0", data: [] }));
    const exchange = exchangeMock({ privateGetTradeFills: getFills, privateGetTradeFillsHistory: getFills });
    const executor = new OkxDemoExecutor(credentials, enabledOptions, exchange);
    const now = Date.now();
    const input = { symbol: "BTC/USDT", from: now - 60_000, to: now };
    await expect(executor.collectFillHistory(input)).resolves.toMatchObject({ status: "unavailable", reason: "demo_not_initialized" });
    expect(getFills).not.toHaveBeenCalled();
    await executor.initialize();
    await expect(executor.collectFillHistory(input)).resolves.toMatchObject({ status: "collected", fills: [] });
    expect(exchange.setSandboxMode).toHaveBeenCalledWith(true);
    expect(getFills).toHaveBeenCalledWith(expect.objectContaining({ instId: "BTC-USDT", instType: "SPOT" }));
    expect(exchange.createMarketBuyOrderWithCost).not.toHaveBeenCalled();
    await executor.close();
    await expect(executor.collectFillHistory(input)).resolves.toMatchObject({ status: "unavailable", reason: "demo_not_initialized" });
  });
  it("fails closed if exchange history methods are absent", async () => {
    const executor = new OkxDemoExecutor(credentials, enabledOptions, exchangeMock());
    await executor.initialize();
    await expect(executor.collectFillHistory({ symbol: "BTC/USDT", from: Date.now() - 1, to: Date.now() })).resolves.toMatchObject({ status: "unavailable", reason: "history_endpoint_unavailable" });
  });
  it("preserves fee currencies and never invents a zero fee", () => {
    expect(normalizedOrderFees({ fee: undefined, fees: undefined })).toEqual([]);
    expect(normalizedOrderFees({ fee: { currency: "BTC", cost: 0.00001 }, fees: undefined })).toEqual([{ currency: "BTC", cost: 0.00001 }]);
  });
  it("does not discard partial or unknown terminal fills", () => {
    expect(classifyDemoOrder("canceled", 0.01)).toBe("PENDING");
    expect(classifyDemoOrder("canceled", undefined)).toBe("PENDING");
    expect(classifyDemoOrder("closed", undefined)).toBe("PENDING");
    expect(classifyDemoOrder("closed", 0)).toBe("PENDING");
    expect(classifyDemoOrder("canceled", 0)).toBe("FAILED");
    expect(classifyDemoOrder("closed", 0.1)).toBe("PLACED");
  });

  it("does not submit a sell using a Paper position quantity", async () => {
    const exchange = exchangeMock({ createOrder: vi.fn() });
    const executor = new OkxDemoExecutor(credentials, enabledOptions, exchange);
    await executor.initialize();
    await expect(executor.executeApprovedSell({ symbol: "BTC/USDT", quantity: 1, candleTimestamp: 1 })).rejects.toThrow("disabled");
    expect(exchange.createOrder).not.toHaveBeenCalled();
  });
  it("persists the intent before submitting and retains it after an ambiguous submission failure", async () => {
    const sequence: string[] = [];
    const exchange = exchangeMock({ createMarketBuyOrderWithCost: vi.fn(async () => { sequence.push("submit"); throw new Error("timeout"); }) });
    const executor = new OkxDemoExecutor(credentials, enabledOptions, exchange);
    executor.setIntentJournal(async () => { sequence.push("intent"); return true; });
    await executor.initialize();
    await expect(executor.executeApprovedBuy({ candleTimestamp: 1790197200000 })).rejects.toThrow("timeout");
    expect(sequence).toEqual(["intent", "submit"]);
  });

  it("never submits if recording the intent fails", async () => {
    const exchange = exchangeMock();
    const executor = new OkxDemoExecutor(credentials, enabledOptions, exchange);
    executor.setIntentJournal(async () => { throw new Error("database unavailable"); });
    await executor.initialize();
    await expect(executor.executeApprovedBuy({ candleTimestamp: 1790197200000 })).rejects.toThrow("database unavailable");
    expect(exchange.createMarketBuyOrderWithCost).not.toHaveBeenCalled();
  });
  it("never submits if no durable intent journal is configured", async () => {
    const exchange = exchangeMock();
    const executor = new OkxDemoExecutor(credentials, enabledOptions, exchange);
    await executor.initialize();
    await expect(executor.executeApprovedBuy({ candleTimestamp: 1790197200000 })).rejects.toThrow("persistent intent journal");
    expect(exchange.createMarketBuyOrderWithCost).not.toHaveBeenCalled();
  });
  it("does not present a partial Demo portfolio valuation as total equity", async () => {
    const exchange = exchangeMock({
      fetchBalance: vi.fn(async () => ({ free: { USDT: 100 }, total: { USDT: 100, DOGE: 5 } })),
      market: vi.fn((symbol: string) => {
        if (symbol !== "BTC/USDT") throw new Error("market unavailable");
        return { symbol, quote: "USDT", spot: true, active: true, limits: { cost: { min: 1 } } };
      }),
    });
    const executor = new OkxDemoExecutor(credentials, enabledOptions, exchange);
    await executor.initialize();
    await expect(executor.getAccountSnapshot()).resolves.toMatchObject({ totalUsdt: 100, equityUsdt: null, unvaluedAssets: ["DOGE"] });
  });
  it("preserves the submitted order as pending when reconciliation fails", async () => {
    const fetchOrder = vi.fn()
      .mockRejectedValueOnce(new OrderNotFound("missing"))
      .mockRejectedValueOnce(new Error("maintenance"));
    const exchange = exchangeMock({
      fetchOrder,
      createMarketBuyOrderWithCost: vi.fn(async () => ({ id: "order-uncertain", status: "open" })),
    });
    const executor = new OkxDemoExecutor(credentials, enabledOptions, exchange, async () => {});
    executor.setIntentJournal(async () => true);
    await executor.initialize();
    await expect(executor.executeApprovedBuy({ candleTimestamp: 1790197200000 })).resolves.toMatchObject({
      status: "PENDING", orderId: "order-uncertain", confirmed: false,
      clientOrderId: createClientOrderId("BTC/USDT", 1790197200000),
    });
  });
  it("forces sandbox first and performs an authenticated balance read", async () => {
    const calls: string[] = [];
    const exchange = exchangeMock({
      setSandboxMode: vi.fn(() => calls.push("sandbox")),
      loadMarkets: vi.fn(async () => {
        calls.push("markets");
        return {};
      }),
      fetchBalance: vi.fn(async () => {
        calls.push("balance");
        return { free: { USDT: 123.45 } };
      }),
    });
    const executor = new OkxDemoExecutor(
      credentials,
      { ...enabledOptions, tradingEnabled: false },
      exchange,
    );

    await expect(executor.initialize()).resolves.toMatchObject({
      authenticated: true,
      quoteFree: 123.45,
      orderExecutionEnabled: false,
    });
    expect(calls).toEqual(["sandbox", "markets", "balance"]);
  });

  it("cannot submit when the explicit demo trading gate is disabled", async () => {
    const exchange = exchangeMock();
    const executor = new OkxDemoExecutor(
      credentials,
      { ...enabledOptions, tradingEnabled: false },
      exchange,
    );
    await executor.initialize();

    await expect(
      executor.executeApprovedBuy({ candleTimestamp: 1_790_197_200_000 }),
    ).resolves.toMatchObject({
      status: "SKIPPED",
      reason: "demo_trading_disabled",
    });
    expect(exchange.fetchOrder).not.toHaveBeenCalled();
    expect(exchange.createMarketBuyOrderWithCost).not.toHaveBeenCalled();
  });

  it("places one Spot market buy with attached market TP and SL", async () => {
    const exchange = exchangeMock();
    const executor = new OkxDemoExecutor(credentials, enabledOptions, exchange);
    const journal = vi.fn(async () => true);
    executor.setIntentJournal(journal);
    await executor.initialize();

    const candleTimestamp = 1_790_197_200_000;
    const result = await executor.executeApprovedBuy({ candleTimestamp });

    expect(result).toMatchObject({
      status: "PLACED",
      orderId: "order-1",
      referencePrice: 100,
      stopLossPrice: 99,
      takeProfitPrice: 102,
    });
    expect(exchange.createMarketBuyOrderWithCost).toHaveBeenCalledWith(
      "BTC/USDT",
      10,
      {
        clientOrderId: createClientOrderId("BTC/USDT", candleTimestamp),
        tdMode: "cash",
        attachAlgoOrds: [{ attachAlgoClOrdId: `AP${createClientOrderId("BTC/USDT", candleTimestamp).slice(2)}`, slTriggerPx: "99", slOrdPx: "-1", tpTriggerPx: "102", tpOrdPx: "-1" }],
      },
    );
    expect(journal).toHaveBeenCalledWith("BTC/USDT", candleTimestamp, createClientOrderId("BTC/USDT", candleTimestamp), `AP${createClientOrderId("BTC/USDT", candleTimestamp).slice(2)}`);
    const actualCcxt = new ccxt.okx();
    actualCcxt.setMarkets([{ id: "BTC-USDT", symbol: "BTC/USDT", base: "BTC", quote: "USDT", baseId: "BTC", quoteId: "USDT", type: "spot", spot: true, active: true, precision: { amount: 0.0001, price: 0.1 }, limits: {} }] as never);
    const args = vi.mocked(exchange.createMarketBuyOrderWithCost).mock.calls[0]!;
    const payload = actualCcxt.createOrderRequest("BTC/USDT", "market", "buy", 10, undefined, { ...args[2], tgtCcy: "quote_ccy" });
    expect(payload).toMatchObject({ instId: "BTC-USDT", side: "buy", ordType: "market", tdMode: "cash", tgtCcy: "quote_ccy", attachAlgoOrds: [{ slTriggerPx: "99", slOrdPx: "-1", tpTriggerPx: "102", tpOrdPx: "-1", attachAlgoClOrdId: `AP${createClientOrderId("BTC/USDT", candleTimestamp).slice(2)}` }] });
  });

  it("skips a candle whose deterministic client order already exists", async () => {
    const exchange = exchangeMock({
      fetchOrder: vi.fn(async () => ({ id: "existing-order" })),
    });
    const executor = new OkxDemoExecutor(credentials, enabledOptions, exchange);
    await executor.initialize();

    await expect(
      executor.executeApprovedBuy({ candleTimestamp: 1_790_197_200_000 }),
    ).resolves.toMatchObject({
      status: "SKIPPED",
      reason: "duplicate_candle_order",
    });
    expect(exchange.createMarketBuyOrderWithCost).not.toHaveBeenCalled();
  });

  it("skips when a regular or protective order is already open", async () => {
    const exchange = exchangeMock({
      fetchOpenOrders: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "protective-order" }]),
    });
    const executor = new OkxDemoExecutor(credentials, enabledOptions, exchange);
    await executor.initialize();

    await expect(
      executor.executeApprovedBuy({ candleTimestamp: 1_790_197_200_000 }),
    ).resolves.toMatchObject({
      status: "SKIPPED",
      reason: "existing_open_order",
    });
    expect(exchange.createMarketBuyOrderWithCost).not.toHaveBeenCalled();
    expect(exchange.fetchOpenOrders).toHaveBeenNthCalledWith(
      2,
      "BTC/USDT",
      undefined,
      100,
      { trigger: true, ordType: "conditional" },
    );
    expect(exchange.fetchOpenOrders).toHaveBeenNthCalledWith(
      3,
      "BTC/USDT",
      undefined,
      100,
      { trigger: true, ordType: "oco" },
    );
  });

  it("rejects non-Spot symbols before reading the balance", async () => {
    const exchange = exchangeMock({
      market: vi.fn(() => ({
        symbol: "BTC/USDT:USDT",
        quote: "USDT",
        spot: false,
        active: true,
      })),
    });
    const executor = new OkxDemoExecutor(credentials, enabledOptions, exchange);

    await expect(executor.initialize()).rejects.toThrow(
      "OKX Demo symbol must be a Spot market",
    );
    expect(exchange.fetchBalance).not.toHaveBeenCalled();
  });
});
