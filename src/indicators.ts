function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new Error("Indicator period must be a positive integer");
  }
}

export function emaSeries(values: number[], period: number): number[] {
  assertPeriod(period);
  if (values.length < period) return [];

  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const multiplier = 2 / (period + 1);
  const output = [seed];

  for (const value of values.slice(period)) {
    output.push(value * multiplier + output[output.length - 1]! * (1 - multiplier));
  }

  return output;
}

export function rsiSeries(values: number[], period = 14): number[] {
  assertPeriod(period);
  if (values.length <= period) return [];

  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index]! - values[index - 1]!;
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  const output = [toRsi(averageGain, averageLoss)];

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index]! - values[index - 1]!;
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    output.push(toRsi(averageGain, averageLoss));
  }

  return output;
}

function toRsi(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + averageGain / averageLoss);
}
