import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useExchangeRate() {
  const [rate, setRate] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchRate() {
      const { data } = await supabase
        .from('exchange_rates')
        .select('rate, fetched_at')
        .eq('from_currency', 'EUR')
        .eq('to_currency', 'USD')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .single()

      if (data?.rate) {
        setRate(Number(data.rate))
        setLoading(false)
        return
      }

      try {
        const res = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD')
        const json = await res.json()
        setRate(json.rates.USD)
      } catch {
        setRate(1.08)
      }
      setLoading(false)
    }
    fetchRate()
  }, [])

  return { rate, loading }
}
