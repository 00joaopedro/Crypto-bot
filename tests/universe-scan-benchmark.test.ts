import { expect, it } from "vitest";
import { benchmarkUniverseScanner } from "../src/universe-scan-benchmark.js";
it("measures bounded production scanner scheduling without network or orders", async () => {
  const benchmark = await benchmarkUniverseScanner();
  expect(benchmark.rows.map(r => r.size)).toEqual([15, 30, 50, 100, 200, 0]);
  for (const row of benchmark.rows) {
    expect(row.candleRequests).toBe(row.targetCandidates - 1);
    expect(row.maximumConcurrentRequests).toBeLessThanOrEqual(2);
    expect(row.passes).toBe(Math.ceil(row.candleRequests / 20));
  }
  expect(benchmark.rows.at(-1)!.minimumLoopDelaySpanMs).toBeGreaterThan(900000);
  expect(benchmark.limitations.join(" ")).toContain("not exchange or Railway latency");
});
