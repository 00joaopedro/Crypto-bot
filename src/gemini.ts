import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { AiDecision, QuantSignal } from "./types.js";

const decisionSchema = z.object({
  approve: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(300),
});

const responseSchema = {
  type: "object",
  properties: {
    approve: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string", maxLength: 300 },
  },
  required: ["approve", "confidence", "reason"],
  additionalProperties: false,
} as const;

export class GeminiRiskFilter {
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async evaluate(signal: QuantSignal): Promise<AiDecision> {
    const prompt = [
      "Act only as a conservative risk filter for an experimental Spot Testnet signal.",
      "Do not invent market news or external facts. Assess only the numeric context supplied.",
      "Reject ambiguous, overextended, or internally inconsistent signals.",
      JSON.stringify(signal),
    ].join("\n");

    const interaction = await this.client.interactions.create({
      model: this.model,
      input: prompt,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: responseSchema,
      },
    });

    return decisionSchema.parse(JSON.parse(interaction.output_text));
  }
}
