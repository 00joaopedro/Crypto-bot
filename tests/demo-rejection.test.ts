import { describe, expect, it } from "vitest";
import { isExplicitDemoPermissionRejection } from "../src/demo-rejection.js";

describe("explicit OKX Demo permission rejection", () => {
  it("accepts only a structured OKX 50123 trading-permission response", () => {
    expect(isExplicitDemoPermissionRejection({ error: 'okx {"msg":"This API Key does not have trading permission for the Crypto","code":"50123"}' })).toBe(true);
    for (const result of [null, {}, { error: "50123" }, { error: 'okx {"msg":"This API Key does not have trading permission for the Crypto","code":"50001"}' }, { error: 'okx {"code":"50123","msg":"timeout"}' }, { error: 'okx {broken' }]) expect(isExplicitDemoPermissionRejection(result)).toBe(false);
  });
});
