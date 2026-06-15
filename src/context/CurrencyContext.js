import { createContext, useContext, useState } from 'react'

const SUPPORTED = ['EUR', 'USD']

const CurrencyContext = createContext()

export function CurrencyProvider({ children }) {
  const [currency, setCurrencyState] = useState(() => {
    const param = new URLSearchParams(window.location.search).get('currency')?.toUpperCase()
    if (param && SUPPORTED.includes(param)) return param
    return localStorage.getItem('bv_currency') || 'EUR'
  })

  function setCurrency(c) {
    localStorage.setItem('bv_currency', c)
    setCurrencyState(c)
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
