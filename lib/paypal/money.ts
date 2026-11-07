export interface Money {
  currency_code: string;
  value: string;
}

export function toCents(value: string | number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`not a money value: ${value}`);
  return Math.round(n * 100);
}

export function money(cents: number, currency: string): Money {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`cents must be a non-negative integer, got ${cents}`);
  return { currency_code: currency, value: (cents / 100).toFixed(2) };
}
