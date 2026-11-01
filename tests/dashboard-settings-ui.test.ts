import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { expect, it } from "vitest";

it("loads every saved field and preserves edits during automatic dashboard rendering", () => {
  const elements = new Map<string, any>();
  const ctx = { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, scale() {} };
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { value: "", textContent: "", innerHTML: "", hidden: true, dataset: {}, lastChild: { textContent: "" }, classList: { toggle() {} }, parentElement: { getBoundingClientRect: () => ({ width: 300, height: 200 }) }, getContext: () => ctx, handlers: {} as Record<string, Function>, addEventListener(event: string, fn: Function) { this.handlers[event] = fn; }, querySelectorAll: () => [] });
    return elements.get(id);
  };
  const document = { getElementById: element, querySelectorAll: () => [], documentElement: { dataset: { theme: "dark" } } };
  const sandbox = createContext({ document, fetch: () => new Promise(() => {}), localStorage: { getItem: () => null }, addEventListener() {}, setInterval() {}, setTimeout() {}, getComputedStyle: () => ({ getPropertyValue: () => "" }), devicePixelRatio: 1, Intl, Number, Date, String, Object, Array, Math, Promise, encodeURIComponent });
  runInContext(readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), sandbox);
  runInContext('state = {paused:true,settings:{symbol:"BTC/USDT",orderSizeUsdt:10,maxTrades:5,maxConcurrentPositions:60,intervalMinutes:15},supportedSymbols:["BTC/USDT"],metrics:{},health:{},orders:[],trades:[],snapshots:[]};render()', sandbox);
  expect(element("max-positions").value).toBe(60);
  element("settings-form").handlers.input();
  element("order-size").value = "25";
  element("max-positions").value = "3";
  runInContext('state.settings.orderSizeUsdt=10;state.settings.maxConcurrentPositions=60;render()', sandbox);
  expect(element("order-size").value).toBe("25");
  expect(element("max-positions").value).toBe("3");
});
