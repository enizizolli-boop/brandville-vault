import { useState, useEffect } from 'react'

export function useExchangeRate() {
  const [rate, setRate] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchRate() {
      try {
        const res = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD')
        const data = await res.json()
        setRate(data.rates.USD)
      } catch {
        setRate(1.08)
      }
      setLoading(false)
    }
    fetchRate()
  }, [])

  return { rate, loading }
}
