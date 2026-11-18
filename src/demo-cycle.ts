export const EDGE_SAMPLE_SIZE = 30;
export const EDGE_THRESHOLD = 0.95;

export function profitFactor(gains: number, losses: number): number | null {
  return losses > 0 ? gains / losses : null;
}

/** Rolling inputs are ordered by exchange close time, with buy order ID breaking ties. */
export function rollingDemoEdge(pnls: number[]) {
  const sample = pnls.slice(-EDGE_SAMPLE_SIZE);
  const gains = sample.reduce((sum, pnl) => sum + Math.max(0, pnl), 0);
  const losses = sample.reduce((sum, pnl) => sum + Math.max(0, -pnl), 0);
  const pf = profitFactor(gains, losses);
  return {
    sampleSize: sample.length, profitFactor: pf,
    degraded: sample.length === EDGE_SAMPLE_SIZE && pf !== null && pf < EDGE_THRESHOLD,
  };
}
