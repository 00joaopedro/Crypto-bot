import { expect, it } from "vitest";
import { rollingDemoEdge } from "../src/demo-cycle.js";

it("requires 30 closes, treats no losses as undefined, and alerts strictly below 0.95", () => {
  expect(rollingDemoEdge(Array(29).fill(-1))).toMatchObject({ sampleSize: 29, degraded: false });
  expect(rollingDemoEdge(Array(30).fill(1))).toMatchObject({ profitFactor: null, degraded: false });
  const breakEven = [...Array(28).fill(0), -20, 19];
  expect(rollingDemoEdge(breakEven)).toMatchObject({ profitFactor: 0.95, degraded: false });
  expect(rollingDemoEdge([100, ...breakEven.slice(0, -1), 18])).toMatchObject({ sampleSize: 30, profitFactor: 0.9, degraded: true });
});
