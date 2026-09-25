import ccxt, { OrderNotFound, type Exchange, type Order } from "ccxt";

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
};

export type DemoBuyRequest = {
  symbol?: string;
  candleTimestamp: number;
  stopLossRate?: number;
  takeProfitRate?: number;
};

export type DemoBuyResult =
  | {
      status: "PLACED";
      orderId: string;
      clientOrderId: string;
      orderStatus: string | null;
      filled: number | null;
      average: number | null;
      cost: number | null;
      referencePrice: number;
      stopLossPrice: number;
      takeProfitPrice: number;
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

type Pause = (milliseconds: number) => Promise<void>;

/** OKX Demo-only Spot executor. Sandbox mode is always forced first. */
export class OkxDemoExecutor {
  private sandboxConfigured = false;
  private initialized = false;

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
    this.initialized = true;

    return {
      provider: "okx-demo",
      authenticated: true,
      symbol: market.symbol,
      quoteCurrency,
      quoteFree,
      orderExecutionEnabled: this.options.tradingEnabled,
    };
  }

  async executeApprovedBuy(request: DemoBuyRequest): Promise<DemoBuyResult> {
    if (!this.initialized) {
      throw new Error("OKX Demo executor must be initialized before execution");
    }

    const marketSymbol = request.symbol ?? this.options.symbol;
    const market = this.exchange.market(marketSymbol);
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

    const existing = await this.findOrderByClientId(clientOrderId);
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

    const submitted = await this.exchange.createMarketBuyOrderWithCost(
      marketSymbol,
      this.options.orderSizeUsdt,
      {
        clientOrderId,
        tdMode: "cash",
        stopLoss: { triggerPrice: stopLossPrice, type: "market" },
        takeProfit: { triggerPrice: takeProfitPrice, type: "market" },
      },
    );
    const order = await this.waitForOrderUpdate(submitted);

    return {
      status: "PLACED",
      orderId: requiredString(order.id, "order id"),
      clientOrderId,
      orderStatus: order.status ?? null,
      filled: finiteOrNull(order.filled),
      average: finiteOrNull(order.average),
      cost: finiteOrNull(order.cost),
      referencePrice,
      stopLossPrice,
      takeProfitPrice,
    };
  }

  listSpotSymbols(quote = "USDT"): string[] {
    if (!this.initialized) return [];
    return Object.values(this.exchange.markets ?? {})
      .filter((market) => market.spot && market.active !== false && market.quote === quote)
      .map((market) => market.symbol)
      .sort();
  }

  async close(): Promise<void> {
    await this.exchange.close();
  }

  private async findOrderByClientId(clientOrderId: string): Promise<Order | null> {
    try {
      return await this.exchange.fetchOrder(clientOrderId, this.options.symbol, {
        clientOrderId,
      });
    } catch (error) {
      if (error instanceof OrderNotFound) return null;
      throw error;
    }
  }

  private async waitForOrderUpdate(submitted: Order): Promise<Order> {
    if (submitted.status === "closed" || submitted.status === "canceled") {
      return submitted;
    }

    const submittedId = requiredString(submitted.id, "submitted order id");
    let latest = submitted;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.pause(1_000);
      latest = await this.exchange.fetchOrder(
        submittedId,
        this.options.symbol,
      );
      if (latest.status === "closed" || latest.status === "canceled") break;
    }
    return latest;
  }
}

function readFreeBalance(free: unknown, currency: string): number | null {
  const balances = (free ?? {}) as Record<string, unknown>;
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
