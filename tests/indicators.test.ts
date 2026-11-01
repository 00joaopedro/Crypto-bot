import { describe, expect, it } from "vitest";
import { emaSeries, rsiSeries } from "../src/indicators.js";

describe("indicators", () => {
  it("calculates a stable EMA for constant prices", () => {
    expect(emaSeries([10, 10, 10, 10, 10], 3)).toEqual([10, 10, 10]);
  });

  it("returns RSI 100 for a strictly rising series", () => {
    expect(rsiSeries([1, 2, 3, 4, 5, 6], 3).at(-1)).toBe(100);
  });

  it("returns RSI 50 for a flat series", () => {
    expect(rsiSeries([5, 5, 5, 5, 5], 3).at(-1)).toBe(50);
  });
});
