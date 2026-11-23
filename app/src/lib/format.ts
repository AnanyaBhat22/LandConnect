/** Indian-style formatting: ₹45 L, ₹1.2 Cr; area in sq ft or acres. */

export function formatPrice(inr: number): string {
  if (inr >= 1e7) return `₹${trim(inr / 1e7)} Cr`;
  if (inr >= 1e5) return `₹${trim(inr / 1e5)} L`;
  return `₹${inr.toLocaleString('en-IN')}`;
}

const SQFT_PER_ACRE = 43560;

export function formatArea(sqft: number | null): string | null {
  if (!sqft) return null;
  if (sqft >= SQFT_PER_ACRE / 2) return `${trim(sqft / SQFT_PER_ACRE)} acres`;
  return `${Math.round(sqft).toLocaleString('en-IN')} sq ft`;
}

/** Price per sq ft helps buyers compare plots of different sizes. */
export function pricePerSqft(inr: number, sqft: number | null): string | null {
  if (!sqft) return null;
  return `₹${Math.round(inr / sqft).toLocaleString('en-IN')}/sq ft`;
}

function trim(n: number): string {
  return n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2).replace(/\.?0+$/, '');
}
