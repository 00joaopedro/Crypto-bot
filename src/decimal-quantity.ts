/** Interpret the finite decimal representation, including scientific notation. */
function decimal(value: number): { units: bigint; scale: number } {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Expected positive finite decimal");
  const [mantissa, exponent = "0"] = value.toString().split("e");
  const [whole, fraction = ""] = mantissa!.split(".");
  const scale = fraction.length - Number(exponent);
  const units = BigInt(whole! + fraction);
  return scale < 0 ? { units: units * 10n ** BigInt(-scale), scale: 0 } : { units, scale };
}

/** Floor budget / (price * step) as decimal integers, without epsilon promotion. */
export function quantizeQuantityDown(budget: number, price: number, step: number): { quantity: number; notional: number } {
  const b = decimal(budget), p = decimal(price), s = decimal(step);
  const steps = (b.units * 10n ** BigInt(p.scale + s.scale)) / (p.units * s.units * 10n ** BigInt(b.scale));
  const units = steps * s.units;
  return {
    quantity: Number(`${units}e-${s.scale}`),
    notional: Number(`${units * p.units}e-${s.scale + p.scale}`),
  };
}
