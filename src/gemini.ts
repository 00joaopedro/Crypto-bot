import { GoogleGenAI, type GenerateContentParameters } from "@google/genai";
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
  private readonly generateContent: GeminiGenerateContent;

  constructor(
    apiKey: string,
    private readonly model: string,
    generateContent?: GeminiGenerateContent,
  ) {
    const client = new GoogleGenAI({ apiKey });
    this.generateContent = generateContent ??
      ((parameters) => client.models.generateContent(parameters));
  }

  async evaluate(signal: QuantSignal): Promise<AiDecision> {
    const prompt = [
      "Act only as a conservative risk filter for an experimental Spot Testnet signal.",
      "Do not invent market news or external facts. Assess only the numeric context supplied.",
      "Reject ambiguous, overextended, or internally inconsistent signals.",
      JSON.stringify(signal),
    ].join("\n");

    const response = await this.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: responseSchema,
        temperature: 0,
      },
    });

    if (typeof response.text !== "string") {
      throw new Error("Gemini returned no text output");
    }

    return decisionSchema.parse(JSON.parse(response.text));
  }
}

export type GeminiGenerateContent = (
  parameters: GenerateContentParameters,
) => Promise<{ readonly text: string | undefined }>;
