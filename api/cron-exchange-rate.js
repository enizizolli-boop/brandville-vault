import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fetchAndStorePair(apiKey, from, to) {
  const response = await fetch(`https://v6.exchangerate-api.com/v6/${apiKey}/pair/${from}/${to}`)
  const data = await response.json()
  if (data.result !== 'success') throw new Error(`ExchangeRate-API error for ${from}/${to}: ${JSON.stringify(data)}`)

  const rate = data.conversion_rate
  await supabase.from('exchange_rates').insert({
    from_currency: from,
    to_currency: to,
    rate,
    fetched_at: new Date().toISOString()
  })
  return rate
}

export default async function handler(req, res) {
  try {
    const apiKey = process.env.EXCHANGERATE_API_KEY
    const eurUsd = await fetchAndStorePair(apiKey, 'EUR', 'USD')
    const cnyEur = await fetchAndStorePair(apiKey, 'CNY', 'EUR')

    return res.status(200).json({ ok: true, rates: { 'EUR-USD': eurUsd, 'CNY-EUR': cnyEur } })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
