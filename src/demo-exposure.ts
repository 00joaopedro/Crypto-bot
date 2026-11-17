import type { OkxDemoAccountSnapshot } from "./okx-demo.js";
import type { VerifiedDemoPosition } from "./demo-execution-safety.js";

/** Keep verified free BRL out of both exposure and the trading budget. */
export function demoTradingExposure(snapshot: OkxDemoAccountSnapshot) {
  const { equityUsdt, quoteFree: freeUsdt, freeBrlValueUsdt: reserve = 0 } = snapshot;
  if (snapshot.quoteCurrency !== "USDT" || snapshot.unvaluedAssets.length > 0 ||
      equityUsdt === null || freeUsdt === null ||
      !Number.isFinite(equityUsdt) || !Number.isFinite(freeUsdt) || !Number.isFinite(reserve) ||
      equityUsdt <= 0 || freeUsdt < 0 || reserve < 0 || freeUsdt > equityUsdt) return null;
  const tradingEquityUsdt = equityUsdt - reserve;
  const exposureUsdt = tradingEquityUsdt - freeUsdt;
  const tolerance = Math.max(1e-8, equityUsdt * Number.EPSILON * 8);
  if (tradingEquityUsdt <= 0 || exposureUsdt < -tolerance) return null;
  return { equityUsdt, freeUsdt, tradingEquityUsdt, brlReserveUsdt: reserve, exposureUsdt: Math.max(0, exposureUsdt) };
}

/** Scope the entry cap to confirmed bot inventory and an explicit Demo allocation. */
export function demoBotExposure(
  snapshot: OkxDemoAccountSnapshot,
  budgetUsdt: number,
  positions: readonly VerifiedDemoPosition[],
) {
  const account = demoTradingExposure(snapshot);
  if (!account || !Number.isFinite(budgetUsdt) || budgetUsdt <= 0) return null;
  const byAsset = new Map<string, number>();
  let exposureUsdt = 0;
  for (const { symbol, quantity } of positions) {
    const asset = /^([A-Z0-9]+)\/USDT$/.exec(symbol)?.[1];
    if (!asset || !Number.isFinite(quantity) || quantity <= 0) return null;
    const price = snapshot.assetUnitValuesUsdt?.[asset];
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
    // Gross quantity can exceed the net holding by fees; value it conservatively.
    const value = quantity * price;
    if (!Number.isFinite(value) || value <= 0) return null;
    byAsset.set(asset, (byAsset.get(asset) ?? 0) + value);
    exposureUsdt += value;
  }
  const tradingEquityUsdt = Math.min(budgetUsdt, account.tradingEquityUsdt, account.freeUsdt + exposureUsdt);
  if (!Number.isFinite(exposureUsdt) || tradingEquityUsdt <= 0) return null;
  return { ...account, tradingEquityUsdt, exposureUsdt, altExposureUsdt: exposureUsdt - (byAsset.get("BTC") ?? 0), byAsset };
}
