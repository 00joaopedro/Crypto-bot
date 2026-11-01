import { describe, expect, it } from "vitest";
import { readDemoAccountIdentity, sameDemoAccount } from "../src/okx-demo-identity.js";

describe("OKX Demo account identity", () => {
  it("ties the saved baseline to the exact authenticated account", () => {
    const identity = readDemoAccountIdentity({ code: "0", data: [{ uid: "42", mainUid: "10" }] });
    expect(identity).toEqual({ uid: "42", mainUid: "10" });
    expect(sameDemoAccount({ uid: "42", mainUid: "10" }, identity!)).toBe(true);
    expect(sameDemoAccount({ uid: "10", mainUid: "10" }, identity!)).toBe(false);
    expect(sameDemoAccount(null, identity!)).toBe(false);
  });
  it("rejects missing or malformed responses", () => {
    expect(readDemoAccountIdentity({ code: "500", data: [] })).toBeNull();
    expect(readDemoAccountIdentity({ code: "0", data: [{ uid: "42" }] })).toBeNull();
    expect(readDemoAccountIdentity({ code: "0", data: [{ uid: "42", mainUid: "10" }, { uid: "43", mainUid: "10" }] })).toBeNull();
  });
});
