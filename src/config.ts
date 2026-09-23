import "dotenv/config";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const schema = z
  .object({
    ENVIRONMENT: z.literal("LOG_ONLY").default("LOG_ONLY"),
    MARKET_DATA_PROVIDER: z.enum(["kraken", "bybit-testnet"]).default("kraken"),
    SYMBOL: z.string().min(3).default("BTC/USDT"),
    TIMEFRAME: z.literal("15m").default("15m"),
    CANDLE_LIMIT: z.coerce.number().int().min(50).max(1000).default(100),
    LOOP_DELAY_MS: z.coerce.number().int().min(10_000).default(60_000),
    GEMINI_ENABLED: booleanString,
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().min(1).default("gemini-flash-latest"),
    MIN_AI_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.82),
    PAPER_INITIAL_BALANCE_USDT: z.coerce.number().positive().default(1000),
    PAPER_TRADE_SIZE_USDT: z.coerce.number().positive().default(100),
    PAPER_FEE_RATE: z.coerce.number().min(0).max(0.1).default(0.001),
    PAPER_SLIPPAGE_RATE: z.coerce.number().min(0).max(0.1).default(0.0005),
    PAPER_STOP_LOSS_RATE: z.coerce.number().gt(0).lt(1).default(0.01),
    PAPER_TAKE_PROFIT_RATE: z.coerce.number().gt(0).lt(1).default(0.02),
  })
  .superRefine((value, ctx) => {
    if (value.GEMINI_ENABLED && !value.GEMINI_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["GEMINI_API_KEY"],
        message: "GEMINI_API_KEY is required when GEMINI_ENABLED=true",
      });
    }
    if (value.PAPER_TRADE_SIZE_USDT > value.PAPER_INITIAL_BALANCE_USDT) {
      ctx.addIssue({
        code: "custom",
        path: ["PAPER_TRADE_SIZE_USDT"],
        message: "PAPER_TRADE_SIZE_USDT cannot exceed PAPER_INITIAL_BALANCE_USDT",
      });
    }
  });

export const config = schema.parse(process.env);
