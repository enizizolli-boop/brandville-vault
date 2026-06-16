import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const FALLBACK_RATES = { 'EUR-USD': 1.08, 'CNY-EUR': 0.13 }

export function useExchangeRate(from = 'EUR', to = 'USD') {
  const [rate, setRate] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    async function fetchRate() {
      const { data, error } = await supabase
        .from('exchange_rates')
        .select('rate')
        .eq('from_currency', from)
        .eq('to_currency', to)
        .order('fetched_at', { ascending: false })
        .limit(1)

      if (!error && data && data.length > 0) {
        setRate(Number(data[0].rate))
        setLoading(false)
        return
      }

      try {
        const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`)
        const json = await res.json()
        setRate(json.rates[to])
      } catch {
        setRate(FALLBACK_RATES[`${from}-${to}`] || 1)
      }
      setLoading(false)
    }
    fetchRate()
  }, [from, to])

  return { rate, loading }
}
