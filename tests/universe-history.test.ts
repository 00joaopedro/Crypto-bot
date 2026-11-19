import { expect, it } from "vitest";
import { collectUniverseHistory } from "../src/universe-history.js";
const page = (quote = "123.45") => ({ code: "0", data: [["0", "100", "101", "99", "100", "1", "1", quote, "1"]] });
it("preserves OKX quote volume without approximating it from base volume and close", async () => {
  const history = await collectUniverseHistory(async () => page(), "BTC-USDT", 0, 900000, 900000);
  expect(history.quoteVolumesUsdt).toEqual([123.45]);
  expect(history.candles[0]!.volume).toBe(1);
});
it.each(["", "NaN", "-1"])("rejects invalid historical quote volume %s", async quote => {
  await expect(collectUniverseHistory(async () => page(quote), "BTC-USDT", 0, 900000, 900000)).rejects.toThrow(/quote volume/);
});
