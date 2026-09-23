import ccxt, { type Exchange } from "ccxt";

export type OkxDemoCredentials = {
  apiKey: string;
  secretKey: string;
  passphrase: string;
};

export type OkxDemoStatus = {
  provider: "okx-demo";
  authenticated: true;
  symbol: string;
  quoteCurrency: string;
  quoteFree: number | null;
  orderExecutionEnabled: false;
};

/**
 * Performs read-only startup checks against OKX Demo Trading.
 * This class deliberately exposes no order method.
 */
export class OkxDemoDiagnostics {
  private sandboxConfigured = false;

  constructor(
    credentials: OkxDemoCredentials,
    private readonly symbol: string,
    private readonly exchange: Exchange = new ccxt.okx({
      apiKey: credentials.apiKey,
      secret: credentials.secretKey,
      password: credentials.passphrase,
      enableRateLimit: true,
      options: { defaultType: "spot" },
    }),
  ) {}

  async initialize(): Promise<OkxDemoStatus> {
    if (!this.sandboxConfigured) {
      // CCXT requires sandbox mode to be its first call after construction.
      this.exchange.setSandboxMode(true);
      this.sandboxConfigured = true;
    }

    await this.exchange.loadMarkets();
    const market = this.exchange.market(this.symbol);
    if (!market.spot) {
      throw new Error(`OKX Demo symbol must be a Spot market: ${this.symbol}`);
    }

    // This authenticated read verifies the API key, secret and passphrase.
    // It does not place, edit or cancel orders.
    const balance = await this.exchange.fetchBalance();
    const quoteCurrency = market.quote;
    const freeBalances = (balance.free ?? {}) as unknown as Record<
      string,
      number | undefined
    >;
    const quoteFree = freeBalances[quoteCurrency];

    return {
      provider: "okx-demo",
      authenticated: true,
      symbol: market.symbol,
      quoteCurrency,
      quoteFree:
        typeof quoteFree === "number" && Number.isFinite(quoteFree)
          ? quoteFree
          : null,
      orderExecutionEnabled: false,
    };
  }

  async close(): Promise<void> {
    await this.exchange.close();
  }
}
