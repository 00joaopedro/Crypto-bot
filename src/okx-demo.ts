import ccxt, { OrderNotFound, type Exchange, type Order } from "ccxt";
import { collectOkxDemoFills, type OkxCollectedFills, type OkxFillHistoryClient } from "./okx-demo-fill-history.js";
import { collectOkxDemoOrderEvidence, type OkxOrderEvidenceClient, type OrderEvidenceResult } from "./okx-demo-order-evidence.js";
import type { JournaledDemoBuy } from "./demo-ownership.js";

export type OkxDemoCredentials = {
  apiKey: string;
  secretKey: string;
  passphrase: string;
};

export type OkxDemoOptions = {
  symbol: string;
  tradingEnabled: boolean;
  orderSizeUsdt: number;
  stopLossRate: number;
  takeProfitRate: number;
};

export type OkxDemoStatus = {
  provider: "okx-demo";
  authenticated: true;
  symbol: string;
  quoteCurrency: string;
  quoteFree: number | null;
  orderExecutionEnabled: boolean;
  totalUsdt?: number | null;
};

export type OkxDemoAccountSnapshot = {
  quoteCurrency: string;
  quoteFree: number | null;
  totalUsdt: number | null;
  equityUsdt: number | null;
  unvaluedAssets: string[];
  updatedAt: string;
};

export type DemoBuyRequest = {
  symbol?: string;
  candleTimestamp: number;
  stopLossRate?: number;
  takeProfitRate?: number;
};
export type DemoSellRequest = { symbol?: string; candleTimestamp: number; quantity: number };

export type DemoBuyResult =
  | {
      status: "PLACED" | "PENDING" | "FAILED";
      orderId: string;
      clientOrderId: string;
      orderStatus: string | null;
      filled: number | null;
      average: number | null;
      cost: number | null;
      referencePrice: number;
      stopLossPrice: number;
      takeProfitPrice: number;
      confirmed: boolean;
      reconciliationError?: string;
      side?: string | null;
      fees?: Array<{ currency: string | null; cost: number | null }>;
      feesPresentOnTerminalResponse?: boolean;
    }
  | {
      status: "SKIPPED";
      reason:
        | "demo_trading_disabled"
        | "duplicate_candle_order"
        | "existing_open_order"
        | "insufficient_quote_balance";
      clientOrderId: string;
  };

export type OkxExecutionError = Error & {
  okxFailureKind?: "availability" | "order_rejected" | undefined;
  okxDetails?: Record<string, unknown>;
};

/** A terminal response with incomplete or partial fills needs manual reconciliation. */
export function classifyDemoOrder(status: string | undefined, filled: number | undefined): "PLACED" | "FAILED" | "PENDING" {
  if (typeof filled !== "number" || !Number.isFinite(filled) || filled < 0) return "PENDING";
  if (status === "closed") return filled > 0 ? "PLACED" : "PENDING";
  if (["canceled", "rejected", "expired"].includes(status ?? "")) return filled === 0 ? "FAILED" : "PENDING";
  return "PENDING";
}

export function normalizedOrderFees(order: { fee?: { currency?: string | undefined; cost?: number | undefined } | undefined; fees?: Array<{ currency?: string | undefined; cost?: number | undefined }> | undefined }): Array<{ currency: string | null; cost: number | null }> {
  const fees = order.fees?.length ? order.fees : order.fee ? [order.fee] : [];
  return fees.map((fee) => ({ currency: typeof fee.currency === "string" ? fee.currency : null, cost: finiteOrNull(fee.cost) }));
}

type Pause = (milliseconds: number) => Promise<void>;

/** OKX Demo-only Spot executor. Sandbox mode is always forced first. */
export class OkxDemoExecutor {
  private sandboxConfigured = false;
  private initialized = false;
  private reserveIntent?: (symbol: string, timestamp: number, clientOrderId: string, attachedAlgoClientId: string) => Promise<boolean>;

  setIntentJournal(reserve: (symbol: string, timestamp: number, clientOrderId: string, attachedAlgoClientId: string) => Promise<boolean>): void {
    this.reserveIntent = reserve;
  }

  async reconcileOrder(symbol: string, clientOrderId: string): Promise<Order | null> {
    if (!this.initialized) throw new Error("OKX Demo executor must be initialized before reconciliation");
    return this.findOrderByClientId(clientOrderId, symbol);
  }

  constructor(
    credentials: OkxDemoCredentials,
    private readonly options: OkxDemoOptions,
    private readonly exchange: Exchange = new ccxt.okx({
      apiKey: credentials.apiKey,
      secret: credentials.secretKey,
      password: credentials.passphrase,
      enableRateLimit: true,
      options: { defaultType: "spot" },
    }),
    private readonly pause: Pause = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async initialize(): Promise<OkxDemoStatus> {
    if (!this.sandboxConfigured) {
      // CCXT adds x-simulated-trading=1. This must be the first call.
      this.exchange.setSandboxMode(true);
      this.sandboxConfigured = true;
    }

    await this.exchange.loadMarkets();
    const market = this.exchange.market(this.options.symbol);
    if (!market.spot) {
      throw new Error(
        `OKX Demo symbol must be a Spot market: ${this.options.symbol}`,
      );
    }
    if (market.active === false) {
      throw new Error(`OKX Demo Spot market is not active: ${this.options.symbol}`);
    }

    const balance = await this.exchange.fetchBalance();
    const quoteCurrency = requiredString(market.quote, "market quote currency");
    const quoteFree = readFreeBalance(balance.free, quoteCurrency);
    const totalUsdt = readTotalBalance(balance.total, quoteCurrency);
    this.initialized = true;

    return {
      provider: "okx-demo",
      authenticated: true,
      symbol: market.symbol,
      quoteCurrency,
      quoteFree,
      orderExecutionEnabled: this.options.tradingEnabled,
      totalUsdt,
    };
  }

  async getAccountSnapshot(): Promise<OkxDemoAccountSnapshot> {
    if (!this.initialized) throw new Error("OKX Demo executor must be initialized before balance queries");
    const market = this.resolveActiveSpotMarket(this.options.symbol);
    const balance = await this.exchange.fetchBalance();
    const quoteCurrency = requiredString(market.quote, "market quote currency");
    const totals = (balance.total ?? {}) as Record<string, unknown>;
    let equity = 0;
    const unvaluedAssets: string[] = [];
    for (const [currency, raw] of Object.entries(totals)) {
      const amount = finiteOrNull(raw);
      if (amount === null || amount < 0) { unvaluedAssets.push(currency); continue; }
      if (amount === 0) continue;
      if (currency === "USDT") { equity += amount; continue; }
      try {
        const spot = this.resolveActiveSpotMarket(`${currency}/USDT`);
        const ticker = await this.exchange.fetchTicker(spot.symbol);
        const price = finiteOrNull(ticker.last);
        if (price === null || price <= 0) throw new Error("No valid last price");
        equity += amount * price;
      } catch {
        unvaluedAssets.push(currency);
      }
    }
    if (readTotalBalance(balance.total, "USDT") === null) unvaluedAssets.push("USDT");
    return { quoteCurrency, quoteFree: readFreeBalance(balance.free, quoteCurrency), totalUsdt: readTotalBalance(balance.total, quoteCurrency), equityUsdt: unvaluedAssets.length ? null : equity, unvaluedAssets, updatedAt: new Date().toISOString() };
  }

  /** Read-only collection, not proof of history coverage or bot ownership. */
  async collectFillHistory(input: { symbol: string; from: number; to: number }): Promise<OkxCollectedFills> {
    if (!this.initialized || !this.sandboxConfigured) return { status: "unavailable", reason: "demo_not_initialized" };
    const client = this.exchange as unknown as Partial<OkxFillHistoryClient>;
    if (typeof client.privateGetTradeFills !== "function" || typeof client.privateGetTradeFillsHistory !== "function") {
      return { status: "unavailable", reason: "history_endpoint_unavailable" };
    }
    return collectOkxDemoFills({
      privateGetTradeFills: (params) => client.privateGetTradeFills!(params),
      privateGetTradeFillsHistory: (params) => client.privateGetTradeFillsHistory!(params),
    }, { ...input, now: Date.now() });
  }

  /** Read-only attribution evidence; it does not establish complete coverage. */
  async collectOrderEvidence(journal: JournaledDemoBuy[]): Promise<OrderEvidenceResult> {
    if (!this.initialized || !this.sandboxConfigured) return { status: "unavailable", reason: "demo_not_initialized" };
    const client = this.exchange as unknown as Partial<OkxOrderEvidenceClient>;
    if (typeof client.privateGetTradeOrder !== "function" || typeof client.privateGetTradeOrderAlgo !== "function") return { status: "unavailable", reason: "order_evidence_endpoint_unavailable" };
    return collectOkxDemoOrderEvidence({
      privateGetTradeOrder: (params) => client.privateGetTradeOrder!(params),
      privateGetTradeOrderAlgo: (params) => client.privateGetTradeOrderAlgo!(params),
    }, journal);
  }

  /** Read account permissions without submitting orders or disclosing credentials. */
  async inspectTradingPermission(): Promise<{ status: "available"; trading: boolean } | { status: "unavailable"; reason: string }> {
    if (!this.initialized || !this.sandboxConfigured) return { status: "unavailable", reason: "demo_not_initialized" };
    const client = this.exchange as unknown as { privateGetAccountConfig?: (params: Record<string, string>) => Promise<unknown> };
    if (typeof client.privateGetAccountConfig !== "function") return { status: "unavailable", reason: "permission_endpoint_unavailable" };
    try {
      const response = await client.privateGetAccountConfig({}) as { code?: unknown; data?: unknown } | null;
      if (!response || response.code !== "0" || !Array.isArray(response.data) || response.data.length !== 1 || !response.data[0] || typeof response.data[0] !== "object") return { status: "unavailable", reason: "invalid_permission_response" };
      const perm = (response.data[0] as Record<string, unknown>).perm;
      if (typeof perm !== "string" || !perm.trim()) return { status: "unavailable", reason: "permission_not_reported" };
      const permissions = perm.split(",").map((part) => part.trim());
      if (permissions.some((part) => !["read_only", "trade", "withdraw"].includes(part))) return { status: "unavailable", reason: "unknown_permission_format" };
      return { status: "available", trading: permissions.includes("trade") };
    } catch {
      return { status: "unavailable", reason: "permission_request_failed" };
    }
  }

  async executeApprovedBuy(request: DemoBuyRequest): Promise<DemoBuyResult> {
    if (!this.initialized) {
      throw new Error("OKX Demo executor must be initialized before execution");
    }

    const requestedSymbol = request.symbol ?? this.options.symbol;
    const market = this.resolveActiveSpotMarket(requestedSymbol);
    const marketSymbol = market.symbol;
    if (!market.spot || market.active === false) {
      throw new Error(`OKX Demo symbol is not an active Spot market: ${marketSymbol}`);
    }
    const clientOrderId = createClientOrderId(
      marketSymbol,
      request.candleTimestamp,
    );
    if (!this.options.tradingEnabled) {
      return {
        status: "SKIPPED",
        reason: "demo_trading_disabled",
        clientOrderId,
      };
    }

    const existing = await this.findOrderByClientId(clientOrderId, marketSymbol);
    if (existing) {
      return {
        status: "SKIPPED",
        reason: "duplicate_candle_order",
        clientOrderId,
      };
    }

    const [regularOrders, conditionalOrders, ocoOrders] = await Promise.all([
      this.exchange.fetchOpenOrders(marketSymbol),
      this.exchange.fetchOpenOrders(
        marketSymbol,
        undefined,
        100,
        { trigger: true, ordType: "conditional" },
      ),
      this.exchange.fetchOpenOrders(
        marketSymbol,
        undefined,
        100,
        { trigger: true, ordType: "oco" },
      ),
    ]);
    if (
      regularOrders.length > 0 ||
      conditionalOrders.length > 0 ||
      ocoOrders.length > 0
    ) {
      return {
        status: "SKIPPED",
        reason: "existing_open_order",
        clientOrderId,
      };
    }

    const balance = await this.exchange.fetchBalance();
    const quoteCurrency = requiredString(market.quote, "market quote currency");
    const quoteFree = readFreeBalance(balance.free, quoteCurrency) ?? 0;
    const minimumCost = market.limits.cost?.min ?? 0;
    if (
      quoteFree < this.options.orderSizeUsdt ||
      this.options.orderSizeUsdt < minimumCost
    ) {
      return {
        status: "SKIPPED",
        reason: "insufficient_quote_balance",
        clientOrderId,
      };
    }

    const ticker = await this.exchange.fetchTicker(marketSymbol);
    const referencePrice = ticker.ask ?? ticker.last;
    if (
      typeof referencePrice !== "number" ||
      !Number.isFinite(referencePrice) ||
      referencePrice <= 0
    ) {
      throw new Error("OKX Demo returned no valid ask/last price");
    }

    const stopLossPrice = referencePrice * (1 - (request.stopLossRate ?? this.options.stopLossRate));
    const takeProfitPrice = referencePrice * (1 + (request.takeProfitRate ?? this.options.takeProfitRate));

    const attachedAlgoClientId = `AP${clientOrderId.slice(2)}`;
    // CCXT currently does not expose attachAlgoClOrdId through stopLoss/takeProfit;
    // raw attachAlgoOrds replaces those parameters, so include both full legs.
    const attachAlgoOrds = [{
      attachAlgoClOrdId: attachedAlgoClientId,
      slTriggerPx: this.exchange.priceToPrecision(marketSymbol, stopLossPrice), slOrdPx: "-1",
      tpTriggerPx: this.exchange.priceToPrecision(marketSymbol, takeProfitPrice), tpOrdPx: "-1",
    }];
    if (!this.reserveIntent) throw new Error("Demo order requires a persistent intent journal");
    if (!(await this.reserveIntent(marketSymbol, request.candleTimestamp, clientOrderId, attachedAlgoClientId))) {
      throw new Error(`Demo order intent already exists: ${clientOrderId}`);
    }
    const submitted = await this.exchange.createMarketBuyOrderWithCost(
      marketSymbol,
      this.options.orderSizeUsdt,
      {
        clientOrderId,
        tdMode: "cash",
        attachAlgoOrds,
      },
    );
    const order = await this.waitForOrderUpdate(submitted, marketSymbol);

    const resultStatus = classifyDemoOrder(order.status, order.filled);
    const confirmed = resultStatus === "PLACED";
    return {
      status: resultStatus,
      orderId: requiredString(order.id, "order id"),
      clientOrderId,
      orderStatus: order.status ?? null,
      filled: finiteOrNull(order.filled),
      average: finiteOrNull(order.average),
      cost: finiteOrNull(order.cost),
      referencePrice,
      stopLossPrice,
      takeProfitPrice,
      confirmed,
      side: order.side ?? "buy",
      fees: normalizedOrderFees(order),
      feesPresentOnTerminalResponse: confirmed && normalizedOrderFees(order).length > 0,
      ...(confirmed ? {} : { reconciliationError: `Final OKX order status was ${order.status ?? "unknown"}` }),
    };
  }

  async executeApprovedSell(request: DemoSellRequest): Promise<DemoBuyResult> {
    // A Paper quantity is not an OKX position. Protective OKX orders may have
    // already sold it, so fail closed until a dedicated exchange ledger exists.
    throw new Error(`OKX Demo sell is disabled pending confirmed position reconciliation: ${request.symbol ?? this.options.symbol}`);
  }

  listSpotSymbols(quote = "USDT"): string[] {
    if (!this.initialized) return [];
    return Object.values(this.exchange.markets ?? {})
      .filter((market) => market.spot && market.active !== false && market.quote === quote)
      .map((market) => market.symbol)
      .sort();
  }

  async close(): Promise<void> {
    this.initialized = false;
    await this.exchange.close();
  }

  private async findOrderByClientId(clientOrderId: string, symbol: string): Promise<Order | null> {
    try {
      return await this.exchange.fetchOrder(clientOrderId, symbol, {
        clientOrderId,
      });
    } catch (error) {
      if (error instanceof OrderNotFound) return null;
      throw error;
    }
  }

  private async waitForOrderUpdate(submitted: Order, symbol: string): Promise<Order> {
    if (submitted.status === "closed" || submitted.status === "canceled") {
      return submitted;
    }

    const submittedId = requiredString(submitted.id, "submitted order id");
    let latest = submitted;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.pause(1_000);
      try {
        latest = await this.exchange.fetchOrder(submittedId, symbol);
      } catch (error) {
        // The exchange may have executed the order even when its status query
        // fails. Keep its identifier and treat the result as unresolved.
        console.error(JSON.stringify({ event: "okx_order_reconciliation_failed", symbol, orderId: submittedId, error: error instanceof Error ? error.message : String(error) }));
        return latest;
      }
      if (latest.status === "closed" || latest.status === "canceled") break;
    }
    return latest;
  }

  private resolveActiveSpotMarket(symbol: string) {
    let market: ReturnType<Exchange["market"]>;
    try {
      market = this.exchange.market(symbol);
    } catch (error) {
      throw createOrderError(`OKX Demo market is unavailable: ${symbol}`, error, "order_rejected");
    }
    if (!market.spot || market.active === false) {
      throw createOrderError(`OKX Demo symbol is not an active Spot market: ${symbol}`, undefined, "order_rejected");
    }
    return market;
  }
}

function createOrderError(
  message: string,
  cause: unknown,
  kind: OkxExecutionError["okxFailureKind"],
): OkxExecutionError {
  const error = new Error(message, cause instanceof Error ? { cause } : undefined) as OkxExecutionError;
  error.okxFailureKind = kind;
  if (cause instanceof Error) {
    error.okxDetails = {
      name: cause.name,
      message: cause.message,
      code: (cause as Error & { code?: unknown }).code,
      response: (cause as Error & { response?: unknown }).response,
    };
  }
  return error;
}

function readFreeBalance(free: unknown, currency: string): number | null {
  const balances = (free ?? {}) as Record<string, unknown>;
  return finiteOrNull(balances[currency]);
}

function readTotalBalance(total: unknown, currency: string): number | null {
  const balances = (total ?? {}) as Record<string, unknown>;
  return finiteOrNull(balances[currency]);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`OKX Demo returned no valid ${field}`);
  }
  return value;
}

export function createClientOrderId(
  symbol: string,
  candleTimestamp: number,
): string {
  const normalizedSymbol = symbol
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 10)
    .toUpperCase();
  return `CB${normalizedSymbol}${candleTimestamp.toString(36).toUpperCase()}`.slice(
    0,
    32,
  );
}

