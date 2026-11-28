import { collectPaperHistory } from './paper-history.js';
import ccxt, { type Exchange } from "ccxt";
import { screenEntryMarkets, type MarketScreen, type MarketScreenOptions } from "./market-eligibility.js";
import type { Candle } from "./types.js";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export type MarketDataProvider = "okx" | "kraken" | "bybit-testnet";

export class PublicMarketData {
  private readonly exchanges = new Map<MarketDataProvider, Exchange>();
  private readonly initializedProviders = new Set<MarketDataProvider>();
  private activeProvider: MarketDataProvider;

  constructor(readonly provider: MarketDataProvider, readonly fallbackProvider?: MarketDataProvider) {
    this.activeProvider = provider;
    this.exchanges.set(provider, createExchange(provider));
    if (fallbackProvider && fallbackProvider !== provider) {
      this.exchanges.set(fallbackProvider, createExchange(fallbackProvider));
    }
  }

  get active(): MarketDataProvider {
    return this.activeProvider;
  }

  async initialize(): Promise<void> {
    let initialized = 0;
    let lastError: unknown;
    for (const [provider, exchange] of this.exchanges) {
      try {
        await this.initializeProvider(provider, exchange);
        initialized += 1;
      } catch (error) {
        lastError = error;
        console.error(JSON.stringify({
          event: "market_data_provider_unavailable",
          provider,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    if (initialized === 0) throw new Error(`No market data provider available: ${String(lastError)}`);
    if (!this.initializedProviders.has(this.provider)) {
      const firstAvailable = [...this.initializedProviders][0];
      if (firstAvailable) this.activeProvider = firstAvailable;
    }
  }

  async fetchClosedCandles(symbol: string, limit: number): Promise<Candle[]> {
    const providers = [this.provider, this.activeProvider, ...this.exchanges.keys()].filter(
      (value, index, all) => all.indexOf(value) === index,
    );
    let lastError: unknown;
    for (const provider of providers) {
      const exchange = this.exchanges.get(provider)!;
      try {
        if (!this.initializedProviders.has(provider)) await this.initializeProvider(provider, exchange);
        const rows = await retry(`fetchOHLCV:${provider}`, () =>
          exchange.fetchOHLCV(symbol, "15m", undefined, limit + 1),
        );
        this.activeProvider = provider;
        const now = Date.now();
        return rows
          .map((row) => ({
            timestamp: requiredNumber(row[0], "timestamp"),
            open: requiredNumber(row[1], "open"),
            high: requiredNumber(row[2], "high"),
            low: requiredNumber(row[3], "low"),
            close: requiredNumber(row[4], "close"),
            volume: requiredNumber(row[5], "volume"),
          }))
          .filter((candle) => candle.timestamp + FIFTEEN_MINUTES_MS <= now)
          .slice(-limit);
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Market data unavailable for ${symbol}: ${String(lastError)}`);
  }

  async fetchRecoveryCandles(symbol: string, cursor: number, through: number): Promise<Candle[]> {
    // One provider for the whole replay; no cross-venue splice on failure.
    const provider = this.provider;
    const exchange = this.exchanges.get(provider)!;
    if (!this.initializedProviders.has(provider)) await this.initializeProvider(provider, exchange);
    if (through + FIFTEEN_MINUTES_MS > Date.now()) throw new Error('recovery_requires_closed_candles');
    return collectPaperHistory(cursor, through, (since, limit) => exchange.fetchOHLCV(symbol, '15m', since, limit));
  }

  /** Bounded scanner: one attempt, fixed venue, no shared provider mutation. */
  async fetchScanCandles(symbol: string, limit: number, provider: MarketDataProvider): Promise<Candle[]> {
    const exchange = this.exchanges.get(provider);
    if (!exchange || !this.initializedProviders.has(provider)) throw new Error("Scan provider is not initialized");
    const rows = await exchange.fetchOHLCV(symbol, "15m", undefined, limit + 1);
    const now = Date.now();
    return rows.map(row => ({
      timestamp: requiredNumber(row[0], "timestamp"), open: requiredNumber(row[1], "open"),
      high: requiredNumber(row[2], "high"), low: requiredNumber(row[3], "low"),
      close: requiredNumber(row[4], "close"), volume: requiredNumber(row[5], "volume"),
    })).filter(candle => candle.timestamp + FIFTEEN_MINUTES_MS <= now).slice(-limit);
  }

  listSpotSymbols(quote = "USDT"): string[] {
    const exchange = this.exchanges.get(this.activeProvider)!;
    return Object.values(exchange.markets ?? {})
      .filter((market) => market.spot && market.active !== false && market.quote === quote)
      .map((market) => market.symbol)
      .sort();
  }

  async screenSpotSymbols(options: MarketScreenOptions): Promise<MarketScreen> {
    // Use the execution venue even when candles temporarily use a fallback.
    const exchange = this.exchanges.get(this.provider)!;
    if (!this.initializedProviders.has(this.provider)) {
      await this.initializeProvider(this.provider, exchange);
    }
    const tickers = await retry("fetchTickers", () => exchange.fetchTickers());
    return screenEntryMarkets(Object.values(exchange.markets ?? {}), tickers, options);
  }

  async selectSpotSymbols(options: MarketScreenOptions & { limit: number }): Promise<string[]> {
    return (await this.screenSpotSymbols(options)).eligible.slice(0, options.limit === 0 ? undefined : options.limit);
  }

  async close(): Promise<void> {
    await Promise.all([...this.exchanges.values()].map((exchange) => exchange.close()));
  }

  private async initializeProvider(provider: MarketDataProvider, exchange: Exchange): Promise<void> {
    if (this.initializedProviders.has(provider)) return;
    if (provider === "bybit-testnet") exchange.setSandboxMode(true);
    await retry(`loadMarkets:${provider}`, () => exchange.loadMarkets());
    this.initializedProviders.add(provider);
  }
}

function createExchange(provider: MarketDataProvider): Exchange {
  return provider === "okx"
    ? new ccxt.okx({ enableRateLimit: true, timeout: 10_000 })
    : provider === "kraken"
      ? new ccxt.kraken({ enableRateLimit: true, timeout: 10_000 })
      : new ccxt.bybit({
            enableRateLimit: true, timeout: 10_000,
            options: { defaultType: "spot" },
          });
}

async function retry<T>(operation: string, action: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return await action(); } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(`${operation} failed after retries: ${String(lastError)}`);
}

function requiredNumber(value: number | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid ${field} value returned by market data provider`);
  }
  return value;
}
