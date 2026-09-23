import ccxt, { type Exchange } from "ccxt";
import type { Candle } from "./types.js";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export type MarketDataProvider = "kraken" | "bybit-testnet";

export class PublicMarketData {
  private readonly exchange: Exchange;

  constructor(readonly provider: MarketDataProvider) {
    this.exchange =
      provider === "kraken"
        ? new ccxt.kraken({ enableRateLimit: true })
        : new ccxt.bybit({
            enableRateLimit: true,
            options: { defaultType: "spot" },
          });
  }

  async initialize(): Promise<void> {
    if (this.provider === "bybit-testnet") {
      // CCXT requires sandbox mode to be the first call after construction.
      this.exchange.setSandboxMode(true);
    }
    await this.exchange.loadMarkets();
  }

  async fetchClosedCandles(symbol: string, limit: number): Promise<Candle[]> {
    const rows = await this.exchange.fetchOHLCV(symbol, "15m", undefined, limit + 1);
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
  }

  async close(): Promise<void> {
    await this.exchange.close();
  }
}

function requiredNumber(value: number | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid ${field} value returned by market data provider`);
  }
  return value;
}
