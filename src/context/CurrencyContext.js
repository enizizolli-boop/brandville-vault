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
    const base = window.location.pathname
    window.history.replaceState(null, '', c === 'USD' ? base + '?usd' : base)
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
