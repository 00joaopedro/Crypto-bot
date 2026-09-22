export type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type QuantSignal = {
  action: "BUY" | "HOLD";
  candleTimestamp: number;
  price: number;
  ema9: number;
  ema21: number;
  previousEma9: number;
  previousEma21: number;
  rsi14: number;
  reason: string;
};

export type AiDecision = {
  approve: boolean;
  confidence: number;
  reason: string;
};
