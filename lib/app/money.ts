export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function formatDollars(amount: number, currency = "USD"): string {
  return formatCents(Math.round(amount * 100), currency);
}

export function toCentsSafe(amount: number): number {
  return Math.round(amount * 100);
}
