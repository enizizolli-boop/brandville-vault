import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  try {
    const apiKey = process.env.EXCHANGERATE_API_KEY
    const response = await fetch(`https://v6.exchangerate-api.com/v6/${apiKey}/pair/EUR/USD`)
    const data = await response.json()

    if (data.result !== 'success') {
      return res.status(500).json({ error: 'ExchangeRate-API error', detail: data })
    }

    const rate = data.conversion_rate

    await supabase.from('exchange_rates').insert({
      from_currency: 'EUR',
      to_currency: 'USD',
      rate,
      fetched_at: new Date().toISOString()
    })

    return res.status(200).json({ ok: true, rate })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
