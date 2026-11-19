import { benchmarkUniverseScanner } from "./universe-scan-benchmark.js";
console.log(JSON.stringify(await benchmarkUniverseScanner(), null, 2));
