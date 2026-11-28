import { describe, expect, it, vi } from "vitest";
import { REGIME_CANDLE_MS } from "../src/btc-regime.js";
import { collectOkxSpotHistory } from "../src/okx-history.js";

const step = REGIME_CANDLE_MS;
const start = Date.parse("2026-11-01T00:00:00Z");
const end = start + 3 * step;

function row(timestamp: number, confirm = "1", close = "11") {
  return [String(timestamp), "10", "12", "9", close, "15", "160", "160", confirm];
}

function page(...data: string[][]) {
  return { code: "0", data };
}

describe("OKX Spot history", () => {
  it("paginates backward, accepts matching overlap and returns ordered OHLCV in base units", async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(row(end, "0"), row(start + 2 * step), row(start + step)))
      .mockResolvedValueOnce(page(row(start + step), row(start), row(start - step)));
    const candles = await collectOkxSpotHistory(fetchPage, "ETH-USDT", start, end, end);
    expect(fetchPage.mock.calls).toEqual([[
      { instId: "ETH-USDT", bar: "15m", after: String(end), limit: "300" },
    ], [
      { instId: "ETH-USDT", bar: "15m", after: String(start + step), limit: "300" },
    ]]);
    expect(candles).toEqual([start, start + step, start + 2 * step].map(timestamp => ({
      timestamp, open: 10, high: 12, low: 9, close: 11, volume: 15,
    })));
  });

  it.each([
    ["missing", [row(start + 2 * step), row(start)]],
    ["unconfirmed", [row(start + 2 * step), row(start + step, "0"), row(start)]],
  ])("rejects a %s candle inside the requested range", async (_name, data) => {
    await expect(collectOkxSpotHistory(async () => page(...data), "ETH-USDT", start, end, end))
      .rejects.toThrow("Missing confirmed OKX candle at 2026-11-01T00:15:00.000Z");
  });

  it("rejects conflicting duplicates across pages", async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(row(start + 2 * step), row(start + step)))
      .mockResolvedValueOnce(page(row(start + step, "1", "12"), row(start)));
    await expect(collectOkxSpotHistory(fetchPage, "ETH-USDT", start, end, end)).rejects.toThrow("Conflicting OKX candles");
  });

  it("rejects a stalled cursor instead of retrying it indefinitely", async () => {
    const fetchPage = vi.fn().mockResolvedValue(page(row(start + step)));
    await expect(collectOkxSpotHistory(fetchPage, "ETH-USDT", start, end, end)).rejects.toThrow("pagination did not advance");
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed OHLCV and unsuccessful API responses", async () => {
    await expect(collectOkxSpotHistory(async () => page(row(start, "1", "40")), "ETH-USDT", start, end, end))
      .rejects.toThrow("Invalid OHLCV");
    await expect(collectOkxSpotHistory(async () => ({ code: "50011", data: [] }), "ETH-USDT", start, end, end))
      .rejects.toThrow("invalid history page");
  });

  it("rejects a window that includes time in the future or is off the candle grid", async () => {
    const fetchPage = vi.fn();
    await expect(collectOkxSpotHistory(fetchPage, "ETH-USDT", start, end, end - 1)).rejects.toThrow("Invalid OKX history window");
    await expect(collectOkxSpotHistory(fetchPage, "ETH-USDT", start + 1, end, end)).rejects.toThrow("Invalid OKX history window");
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

it('collects hourly closed bars with hourly pagination/grid and rejects a missing hour',async()=>{
 const hour=3600000,from=Date.parse('2026-11-01T00:00:00Z'),to=from+3*hour;
 const fetchPage=vi.fn().mockResolvedValue(page(row(from+2*hour),row(from+hour),row(from)));
 expect((await collectOkxSpotHistory(fetchPage,'BTC-USDT',from,to,to,'1H')).map(c=>c.timestamp)).toEqual([from,from+hour,from+2*hour]);
 expect(fetchPage.mock.calls[0]![0]).toMatchObject({bar:'1H',after:String(to)});
 await expect(collectOkxSpotHistory(async()=>page(row(from+2*hour),row(from)),'BTC-USDT',from,to,to,'1H')).rejects.toThrow('Missing confirmed');
 await expect(collectOkxSpotHistory(fetchPage,'BTC-USDT',from+900000,to,to,'1H')).rejects.toThrow('Invalid OKX history window');
});
