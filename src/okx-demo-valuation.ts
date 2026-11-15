const MAX_QUOTE_AGE_MS = 2 * 60_000;
const MAX_CLOCK_SKEW_MS = 10_000;

export type ValuationFailure = "market_unavailable" | "quote_unavailable" | "invalid_quote" | "stale_quote";
export type ValuationAttempt = { pair: string; source: "demo" | "public_okx"; reason: ValuationFailure };
type Ticker = { last?: unknown; timestamp?: unknown; symbol?: unknown };
export type ValuationQuote = { pairs: string[]; source: ValuationAttempt["source"] };
type Result = { rate: number; quote: ValuationQuote; attempts: ValuationAttempt[] } | { rate: null; attempts: ValuationAttempt[] };

function quoteFailure(ticker: Ticker, now: number): ValuationFailure | undefined {
  if (typeof ticker.last !== "number" || !Number.isFinite(ticker.last) || ticker.last <= 0 ||
      typeof ticker.timestamp !== "number" || !Number.isSafeInteger(ticker.timestamp) || ticker.timestamp <= 0) {
    return "invalid_quote";
  }
  if (now - ticker.timestamp > MAX_QUOTE_AGE_MS || ticker.timestamp - now > MAX_CLOCK_SKEW_MS) return "stale_quote";
}

export async function readPublicOkxTicker(pair: string): Promise<Ticker> {
  const instId = pair.replace("/", "-");
  const url = new URL("https://www.okx.com/api/v5/market/ticker");
  url.searchParams.set("instId", instId);
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000), redirect: "error" });
  if (!response.ok) throw new Error("OKX public ticker request failed");
  const payload = await response.json() as { code?: unknown; data?: Array<{ instId?: unknown; last?: unknown; ts?: unknown }> };
  const row = Array.isArray(payload?.data) && payload.data.length === 1 ? payload.data[0] : undefined;
  if (payload?.code !== "0") throw new Error("OKX public ticker unavailable");
  if (!row || row.instId !== instId) return {};
  return { symbol: pair, last: typeof row.last === "string" ? Number(row.last) : null,
    timestamp: typeof row.ts === "string" ? Number(row.ts) : null };
}

export async function demoValuationRate(
  currency: string,
  resolveMarket: (pair: string) => string,
  fetchDemoTicker: (pair: string) => Promise<Ticker>,
  fetchPublicTicker: (pair: string) => Promise<Ticker>,
): Promise<Result> {
  const attempts: ValuationAttempt[] = [];
  const read = async (pair: string, source: ValuationAttempt["source"]): Promise<number | null> => {
    if (source === "demo") {
      try {
        if (resolveMarket(pair) !== pair) throw new Error("Unexpected market symbol");
      } catch {
        attempts.push({ pair, source, reason: "market_unavailable" });
        return null;
      }
    }

    let ticker: Ticker;
    try {
      ticker = await (source === "demo" ? fetchDemoTicker(pair) : fetchPublicTicker(pair));
    } catch {
      attempts.push({ pair, source, reason: "quote_unavailable" });
      return null;
    }
    const reason = ticker.symbol !== undefined && ticker.symbol !== pair ? "invalid_quote" : quoteFailure(ticker, Date.now());
    if (reason) {
      attempts.push({ pair, source, reason });
      return null;
    }
    return ticker.last as number;
  };

  const directPair = `${currency}/USDT`;
  const direct = await read(directPair, "demo");
  if (direct !== null) return { rate: direct, quote: { pairs: [directPair], source: "demo" }, attempts };
  const inversePair = `USDT/${currency}`;
  const inverse = await read(inversePair, "demo");
  if (inverse !== null && Number.isFinite(1 / inverse)) return { rate: 1 / inverse, quote: { pairs: [inversePair], source: "demo" }, attempts };

  // Public quotes value BRL already held in Demo. They never enter the order path.
  if (currency === "BRL") {
    const publicInverse = await read(inversePair, "public_okx");
    if (publicInverse !== null && Number.isFinite(1 / publicInverse)) return { rate: 1 / publicInverse, quote: { pairs: [inversePair], source: "public_okx" }, attempts };

    // Use both quoted legs. BRL1 is a separate asset and does not imply parity.
    const [brlPerBrl1, usdtPerBrl1] = await Promise.all([
      read("BRL1/BRL", "public_okx"), read("BRL1/USDT", "public_okx"),
    ]);
    if (brlPerBrl1 !== null && usdtPerBrl1 !== null) {
      const rate = usdtPerBrl1 / brlPerBrl1;
      if (Number.isFinite(rate) && rate > 0) return { rate, quote: { pairs: ["BRL1/BRL", "BRL1/USDT"], source: "public_okx" }, attempts };
    }
  }
  return { rate: null, attempts };
}
