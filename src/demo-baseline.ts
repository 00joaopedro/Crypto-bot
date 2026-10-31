/** Balance comparison is diagnostic evidence only. Matching balances cannot
 * establish that no intervening trades or transfers occurred. */
export function compareDemoBaseline(candidate: Record<string, number>, current: Record<string, number>): { status: "unavailable"; reason: string } {
  if (!candidate || !current || typeof candidate !== "object" || typeof current !== "object" || Array.isArray(candidate) || Array.isArray(current)) return { status: "unavailable", reason: "invalid_baseline_balances" };
  const assets = new Set([...Object.keys(candidate), ...Object.keys(current)]);
  if (!Object.hasOwn(candidate, "USDT") || !Object.hasOwn(current, "USDT")) return { status: "unavailable", reason: "baseline_usdt_missing" };
  for (const asset of assets) {
    if (!/^[A-Z0-9]+$/.test(asset)) return { status: "unavailable", reason: "invalid_baseline_balances" };
    const before = Object.hasOwn(candidate, asset) ? candidate[asset] : 0, after = Object.hasOwn(current, asset) ? current[asset] : 0;
    if (typeof before !== "number" || typeof after !== "number" || !Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after < 0) return { status: "unavailable", reason: "invalid_baseline_balances" };
    if (Math.abs(before - after) > Math.max(before, after) * 1e-8) return { status: "unavailable", reason: "baseline_balance_changed" };
  }
  return { status: "unavailable", reason: "baseline_history_coverage_unconfirmed" };
}
