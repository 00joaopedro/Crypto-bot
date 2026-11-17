import { expect, it } from "vitest";
import { HOUR_MS, pairCooldownUntil } from "../src/pair-cooldown.js";

it("requires three recent consecutive net losses and expires without rearming from the same history", () => {
  const closedAt = 200 * HOUR_MS;
  const losses = [0, 1, 2].map(hours => ({ closedAt: closedAt - hours * HOUR_MS, netPnlUsdt: -1 }));
  const policy = { hours: 6, minLosses: 3 };
  expect(pairCooldownUntil(losses, closedAt + 5 * HOUR_MS, policy)).toBe(closedAt + 6 * HOUR_MS);
  expect(pairCooldownUntil(losses, closedAt + 6 * HOUR_MS, policy)).toBeUndefined();
  expect(pairCooldownUntil(losses.slice(0, 2), closedAt, policy)).toBeUndefined();
  expect(pairCooldownUntil([{ ...losses[0]!, netPnlUsdt: 0 }, ...losses.slice(1)], closedAt, policy)).toBeUndefined();
  expect(pairCooldownUntil([losses[0]!, losses[1]!, { ...losses[2]!, closedAt: 0 }], closedAt, policy)).toBeUndefined();
});

it.each([
  { extraMs: 0, expectedCooldown: true },
  { extraMs: 1, expectedCooldown: false },
])("checks the 48-hour window between the first and third losses ($extraMs ms over)", ({ extraMs, expectedCooldown }) => {
  const closedAt = 200 * HOUR_MS;
  const losses = [
    { closedAt, netPnlUsdt: -1 },
    { closedAt: closedAt - 24 * HOUR_MS, netPnlUsdt: -1 },
    { closedAt: closedAt - 48 * HOUR_MS - extraMs, netPnlUsdt: -1 },
  ];
  const policy = { hours: 6, minLosses: 3 };
  expect(pairCooldownUntil(losses, closedAt + HOUR_MS, policy)).toBe(
    expectedCooldown ? closedAt + 6 * HOUR_MS : undefined,
  );
});
