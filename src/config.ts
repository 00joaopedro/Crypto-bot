import "dotenv/config";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const optionalUrl = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().url().optional());

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().optional());

const schema = z
  .object({
    ENVIRONMENT: z.enum(["LOG_ONLY", "DEMO"]).default("LOG_ONLY"),
    MARKET_DATA_PROVIDER: z.enum(["kraken", "bybit-testnet"]).default("kraken"),
    EXECUTION_PROVIDER: z.enum(["disabled", "okx-demo"]).default("disabled"),
    LIVE_TRADING_ENABLED: z.literal("false").default("false").transform(() => false),
    OKX_DEMO_TRADING_ENABLED: booleanString,
    OKX_DEMO_ORDER_SIZE_USDT: z.coerce.number().positive().max(100).default(10),
    OKX_DEMO_STOP_LOSS_RATE: z.coerce.number().gt(0).lt(1).default(0.01),
    OKX_DEMO_TAKE_PROFIT_RATE: z.coerce.number().gt(0).lt(1).default(0.02),
    OKX_API_KEY: z.string().optional(),
    OKX_SECRET_KEY: z.string().optional(),
    OKX_PASSPHRASE: z.string().optional(),
    SYMBOL: z.string().min(3).default("BTC/USDT"),
    TIMEFRAME: z.literal("15m").default("15m"),
    CANDLE_LIMIT: z.coerce.number().int().min(50).max(1000).default(100),
    LOOP_DELAY_MS: z.coerce.number().int().min(10_000).default(60_000),
    DATABASE_URL: optionalUrl,
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(60_000)
      .default(10_000),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DASHBOARD_PASSWORD: optionalTrimmedString,
    DASHBOARD_SESSION_SECRET: optionalTrimmedString,
    GEMINI_ENABLED: booleanString,
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().min(1).default("gemini-flash-latest"),
    MIN_AI_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.82),
    MIN_SIGNAL_SCORE: z.coerce.number().int().min(1).max(8).default(5),
    SIGNAL_SCAN_SYMBOLS: z.string().default(""),
    PAPER_INITIAL_BALANCE_USDT: z.coerce.number().positive().default(1000),
    PAPER_TRADE_SIZE_USDT: z.coerce.number().positive().default(100),
    PAPER_FEE_RATE: z.coerce.number().min(0).max(0.1).default(0.001),
    PAPER_SLIPPAGE_RATE: z.coerce.number().min(0).max(0.1).default(0.0005),
    PAPER_STOP_LOSS_RATE: z.coerce.number().gt(0).lt(1).default(0.01),
    PAPER_TAKE_PROFIT_RATE: z.coerce.number().gt(0).lt(1).default(0.02),
    ATR_PERIOD: z.coerce.number().int().min(5).max(100).default(14),
    ATR_STOP_MULTIPLIER: z.coerce.number().gt(0).max(10).default(1.5),
    ATR_TAKE_PROFIT_MULTIPLIER: z.coerce.number().gt(0).max(20).default(3),
    ATR_MIN_STOP_RATE: z.coerce.number().gt(0).lt(1).default(0.005),
    ATR_MAX_STOP_RATE: z.coerce.number().gt(0).lt(1).default(0.03),
    RISK_MAX_EXPOSURE_PERCENT: z.coerce.number().gt(0).max(1).default(0.25),
    RISK_PER_TRADE_PERCENT: z.coerce.number().gt(0).max(0.1).default(0.01),
    RISK_MAX_DAILY_LOSS_PERCENT: z.coerce.number().gt(0).max(1).default(0.03),
    RISK_MAX_DRAWDOWN_PERCENT: z.coerce.number().gt(0).max(1).default(0.1),
    RISK_MAX_TRADES_PER_HOUR: z.coerce.number().int().min(1).max(100).default(3),
    EMAIL_ALERTS_ENABLED: booleanString,
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: optionalTrimmedString,
    EMAIL_ALERT_TO: optionalTrimmedString,
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
    if (value.EXECUTION_PROVIDER === "okx-demo") {
      for (const key of [
        "OKX_API_KEY",
        "OKX_SECRET_KEY",
        "OKX_PASSPHRASE",
      ] as const) {
        if (!value[key]?.trim()) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when EXECUTION_PROVIDER=okx-demo`,
          });
        }
      }
    }
    if (value.OKX_DEMO_TRADING_ENABLED) {
      if (!value.DATABASE_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message:
            "DATABASE_URL is required when OKX_DEMO_TRADING_ENABLED=true",
        });
      }
      if (value.ENVIRONMENT !== "DEMO") {
        ctx.addIssue({
          code: "custom",
          path: ["ENVIRONMENT"],
          message: "ENVIRONMENT must be DEMO when OKX_DEMO_TRADING_ENABLED=true",
        });
      }
      if (value.EXECUTION_PROVIDER !== "okx-demo") {
        ctx.addIssue({
          code: "custom",
          path: ["EXECUTION_PROVIDER"],
          message:
            "EXECUTION_PROVIDER must be okx-demo when OKX_DEMO_TRADING_ENABLED=true",
        });
      }
    }
    if (
      value.DASHBOARD_PASSWORD &&
      (!value.DASHBOARD_SESSION_SECRET ||
        value.DASHBOARD_SESSION_SECRET.length < 32)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["DASHBOARD_SESSION_SECRET"],
        message:
          "DASHBOARD_SESSION_SECRET must contain at least 32 characters",
      });
    }
    if (value.DASHBOARD_SESSION_SECRET && !value.DASHBOARD_PASSWORD) {
      ctx.addIssue({
        code: "custom",
        path: ["DASHBOARD_PASSWORD"],
        message:
          "DASHBOARD_PASSWORD is required when a session secret is configured",
      });
    }
    if (value.EMAIL_ALERTS_ENABLED) {
      for (const key of ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_ALERT_TO"] as const) {
        if (!value[key]?.trim()) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when EMAIL_ALERTS_ENABLED=true`,
          });
        }
      }
    }
  });

export function parseConfig(environment: NodeJS.ProcessEnv): z.infer<typeof schema> {
  return schema.parse(environment);
}

export const config = parseConfig(process.env);
