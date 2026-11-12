import { readFile } from "node:fs/promises";
import { compareDemoStrategies, type ComparisonOptions } from "./strategy-comparison.js";
import { validateDemoStrategy } from "./strategy-validation.js";
import type { Candle } from "./types.js";
import type { WalkForwardOptions } from "./walk-forward.js";

const comparing = process.argv[2] === "--compare";
const path = process.argv[comparing ? 3 : 2];
if (!path) throw new Error("Usage: npm run strategy:validate -- <input.json>");
const input = JSON.parse(await readFile(path, "utf8")) as { candles: Candle[]; btcCandles?: Candle[]; options: WalkForwardOptions };
if (comparing) {
  console.log(JSON.stringify(compareDemoStrategies(input.candles, input.options as unknown as ComparisonOptions, input.btcCandles), (_key, value: unknown) => typeof value === "number" && !Number.isFinite(value) ? null : value, 2));
} else {
if (!Array.isArray(input.candles) || !input.options || !input.options.base || !Array.isArray(input.options.candidates)) throw new Error("Input must include candles and walk-forward options");
console.log(JSON.stringify(validateDemoStrategy(input.candles, input.options), (_key, value: unknown) => typeof value === "number" && !Number.isFinite(value) ? null : value, 2));

}
