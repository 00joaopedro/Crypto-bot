import { readFile } from "node:fs/promises";
import { validateDemoStrategy } from "./strategy-validation.js";
import type { Candle } from "./types.js";
import type { WalkForwardOptions } from "./walk-forward.js";

const path = process.argv[2];
if (!path) throw new Error("Usage: npm run strategy:validate -- <input.json>");
const input = JSON.parse(await readFile(path, "utf8")) as { candles: Candle[]; options: WalkForwardOptions };
if (!Array.isArray(input.candles) || !input.options || !input.options.base || !Array.isArray(input.options.candidates)) throw new Error("Input must include candles and walk-forward options");
console.log(JSON.stringify(validateDemoStrategy(input.candles, input.options), (_key, value: unknown) => typeof value === "number" && !Number.isFinite(value) ? null : value, 2));
