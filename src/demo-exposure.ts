import type { OkxDemoAccountSnapshot } from "./okx-demo.js";

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
