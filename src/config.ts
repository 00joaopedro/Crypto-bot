import "dotenv/config";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const schema = z
  .object({
    ENVIRONMENT: z.literal("LOG_ONLY").default("LOG_ONLY"),
    SYMBOL: z.string().min(3).default("BTC/USDT"),
    TIMEFRAME: z.literal("15m").default("15m"),
    CANDLE_LIMIT: z.coerce.number().int().min(50).max(1000).default(100),
    LOOP_DELAY_MS: z.coerce.number().int().min(10_000).default(60_000),
    GEMINI_ENABLED: booleanString,
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().min(1).default("gemini-3.8-flash"),
    MIN_AI_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.82),
  })
  .superRefine((value, ctx) => {
    if (value.GEMINI_ENABLED && !value.GEMINI_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["GEMINI_API_KEY"],
        message: "GEMINI_API_KEY is required when GEMINI_ENABLED=true",
      });
    }
  });

export const config = schema.parse(process.env);
