// B2C markup brackets — placeholder percentages, tune later.
// Applied to the dealer/wholesale EUR price before currency conversion.
const B2C_MARKUP_BRACKETS = [
  { max: 5000, pct: 0.30 },
  { max: 20000, pct: 0.20 },
  { max: Infinity, pct: 0.10 },
]

export function applyB2CMarkup(priceEur) {
  if (!priceEur) return priceEur
  const price = Number(priceEur)
  const bracket = B2C_MARKUP_BRACKETS.find(b => price <= b.max)
  return Math.round(price * (1 + (bracket ? bracket.pct : 0.10)))
}

export function isB2CRole(role) {
  return role === 'b2c'
}
