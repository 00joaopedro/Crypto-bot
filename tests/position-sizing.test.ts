import { describe, expect, it } from "vitest";
import { positionSize } from "../src/position-sizing.js";

const input = {
  limits: { riskPerTrade: 0.01, maxExposure: 0.25, maxAltExposure: 0.1, maxSymbolExposure: 0.15 },
  equity: 1000, free: 1000, exposure: 0, altExposure: 0, symbolExposure: 0,
  altcoin: false, ceiling: 1000, stopRate: 0.1, fee: 0.001, slippage: 0.002, liquidity: 1000,
};

describe("risk-based order sizing", () => {
  it("reduces notional for a wider stop and estimated round-trip costs", () => {
    const sized = positionSize(input);
    expect(sized * 0.106).toBeCloseTo(10);
    expect(positionSize({ ...input, stopRate: 0.2 })).toBeLessThan(sized);
  });

  it("caps the shared exposure, individual asset, altcoins, cash and liquidity independently", () => {
    expect(positionSize({ ...input, exposure: 245 })).toBe(5);
    expect(positionSize({ ...input, symbolExposure: 143 })).toBe(7);
    expect(positionSize({ ...input, altcoin: true, altExposure: 97 })).toBe(3);
    expect(positionSize({ ...input, altcoin: true, altExposure: 100 })).toBe(0);
    expect(positionSize({ ...input, free: 4 })).toBeLessThan(4);
    expect(positionSize({ ...input, liquidity: 2 })).toBe(2);
    expect(positionSize({ ...input, stopRate: NaN })).toBe(0);
  });
});
