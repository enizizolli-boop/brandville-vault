import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fetchAndStorePair(apiKey, from, to) {
  // If a manual rate was set today AFTER the cron window (7:00–7:10 AM UTC),
  // respect it and skip the auto-fetch so it doesn't overwrite the human value.
  const cronWindowEnd = new Date()
  cronWindowEnd.setUTCHours(7, 10, 0, 0)
  const { data: recent } = await supabase
    .from('exchange_rates').select('fetched_at')
    .eq('from_currency', from).eq('to_currency', to)
    .order('fetched_at', { ascending: false }).limit(1)
  if (recent?.[0] && new Date(recent[0].fetched_at) > cronWindowEnd) {
    console.log(`Skipping ${from}→${to}: manual rate set at ${recent[0].fetched_at}`)
    return null
  }

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
