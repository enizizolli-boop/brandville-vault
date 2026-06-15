import { createContext, useContext, useState } from 'react'

const SUPPORTED = ['EUR', 'USD']

const CurrencyContext = createContext()

export function CurrencyProvider({ children }) {
  const [currency, setCurrencyState] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('usd')) return 'USD'
    return localStorage.getItem('bv_currency') || 'EUR'
  })

  function setCurrency(c) {
    localStorage.setItem('bv_currency', c)
    setCurrencyState(c)
    const url = new URL(window.location.href)
    if (c === 'USD') {
      url.searchParams.set('usd', '')
    } else {
      url.searchParams.delete('usd')
    }
    window.history.replaceState(null, '', url.toString())
  }

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  return useContext(CurrencyContext)
}
