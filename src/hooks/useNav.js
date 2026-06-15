import { useNavigate } from 'react-router-dom'
import { useCurrency } from '../context/CurrencyContext'

// Routes where ?usd should travel with the user when currency is USD
const CATALOG_ROUTES = ['/home', '/catalog', '/watches', '/jewellery', '/bags']

export function useNav() {
  const navigate = useNavigate()
  const { currency } = useCurrency()

  return (to, options) => {
    if (typeof to === 'number' || currency !== 'USD') return navigate(to, options)
    const path = typeof to === 'string' ? to : ''
    const isCatalog = CATALOG_ROUTES.some(r => path === r || path.startsWith(r + '/') || path.startsWith(r + '?'))
    if (!isCatalog) return navigate(to, options)
    const sep = path.includes('?') ? '&' : '?'
    return navigate(path + sep + 'usd', options)
  }
}
