// B2C markup brackets applied to the dealer EUR price before currency conversion.
// Bands and percentages derived from Brandville's actual cost-to-price data (6,651 items).
const B2C_MARKUP_BRACKETS = [
  { max: 5000,     pct: 0.25 }, // €1k–5k:   +25%
  { max: 10000,    pct: 0.18 }, // €5k–10k:  +18%
  { max: 25000,    pct: 0.12 }, // €10k–25k: +12%
  { max: 50000,    pct: 0.10 }, // €25k–50k: +10%
  { max: Infinity, pct: 0.08 }, // €50k+:    +8%
]

// Bags use a flat markup on cost price rather than on the dealer selling price.
const BAGS_B2C_MULTIPLIER = 1.45

export function applyB2CMarkup(priceEur, { category, costEur } = {}) {
  // Jewellery: show dealer price unchanged
  if (category === 'Jewellery') return priceEur ? Number(priceEur) : null

  // Bags & Accessories (belts, wallets, scarves, etc.): cost + 45%
  if (category === 'Bags' || category === 'Accessories') {
    if (!costEur) return priceEur ? Number(priceEur) : null
    return Math.round(Number(costEur) * BAGS_B2C_MULTIPLIER)
  }

  // Watches (and anything else): tiered bracket on dealer price
  if (!priceEur) return null
  const price = Number(priceEur)
  const bracket = B2C_MARKUP_BRACKETS.find(b => price <= b.max)
  return Math.round(price * (1 + (bracket ? bracket.pct : 0.08)))
}

export function isB2CRole(role) {
  return role === 'b2c'
}
