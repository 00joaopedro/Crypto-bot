import { describe, expect, it, vi } from "vitest";
import {
  GeminiRiskFilter,
  type GeminiGenerateContent,
} from "../src/gemini.js";
import type { QuantSignal } from "../src/types.js";

const signal: QuantSignal = {
  action: "BUY",
  candleTimestamp: 1_790_200_800_000,
  price: 84_620.9,
  ema9: 84_434.98,
  ema21: 84_429.12,
  previousEma9: 84_388.5,
  previousEma21: 84_409.95,
  rsi14: 54.2,
  reason: "EMA9 crossed above EMA21",
};

describe("GeminiRiskFilter", () => {
  it("uses generateContent with a strict JSON response schema", async () => {
    const generateContent = vi.fn<GeminiGenerateContent>(async () => ({
      text: JSON.stringify({
        approve: true,
        confidence: 0.91,
        reason: "Signal is internally consistent",
      }),
    }));
    const filter = new GeminiRiskFilter(
      "test-key",
      "gemini-flash-latest",
      generateContent,
    );

    await expect(filter.evaluate(signal)).resolves.toEqual({
      approve: true,
      confidence: 0.91,
      reason: "Signal is internally consistent",
    });
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-flash-latest",
        config: expect.objectContaining({
          responseMimeType: "application/json",
          responseJsonSchema: expect.objectContaining({
            required: ["approve", "confidence", "reason"],
            additionalProperties: false,
          }),
          temperature: 0,
        }),
      }),
    );
  });

  it("rejects malformed model output so trading remains fail-closed", async () => {
    const generateContent = vi.fn<GeminiGenerateContent>(async () => ({
      text: JSON.stringify({ approve: true, confidence: 4, reason: "invalid" }),
    }));
    const filter = new GeminiRiskFilter(
      "test-key",
      "gemini-flash-latest",
      generateContent,
    );

    await expect(filter.evaluate(signal)).rejects.toThrow();
  });

  it("rejects responses without text", async () => {
    const generateContent = vi.fn<GeminiGenerateContent>(async () => ({
      text: undefined,
    }));
    const filter = new GeminiRiskFilter(
      "test-key",
      "gemini-flash-latest",
      generateContent,
    );

    await expect(filter.evaluate(signal)).rejects.toThrow(
      "Gemini returned no text output",
    );
  });
});
