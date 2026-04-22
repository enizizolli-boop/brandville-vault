import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CurrencyProvider } from './context/CurrencyContext'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Home from './pages/Home'
import DealerCatalog from './pages/DealerCatalog'
import WatchDetail from './pages/WatchDetail'
import AgentListings from './pages/AgentListings'
import AdminPanel from './pages/AdminPanel'
import DealerOffers from './pages/DealerOffers'

function PrivateRoute({ children, allowedRoles }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <div className="loading-page"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (allowedRoles && !allowedRoles.includes(profile?.role)) return <Navigate to="/" replace />
  return children
}

function RoleRedirect() {
  const { profile, loading } = useAuth()
  if (loading) return <div className="loading-page"><div className="spinner" /></div>
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role === 'admin') return <Navigate to="/admin" replace />
  if (profile.role === 'agent') return <Navigate to="/home" replace />
  return <Navigate to="/home" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <CurrencyProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/" element={<PrivateRoute><RoleRedirect /></PrivateRoute>} />
          <Route path="/home" element={<PrivateRoute allowedRoles={['dealer', 'agent', 'admin']}><Home /></PrivateRoute>} />
          <Route path="/catalog" element={<PrivateRoute allowedRoles={['dealer', 'admin', 'agent']}><DealerCatalog /></PrivateRoute>} />
          <Route path="/watches" element={<PrivateRoute allowedRoles={['dealer', 'admin', 'agent']}><DealerCatalog routeCategory="Watches" /></PrivateRoute>} />
          <Route path="/jewellery" element={<PrivateRoute allowedRoles={['dealer', 'admin', 'agent']}><DealerCatalog routeCategory="Jewellery" /></PrivateRoute>} />
          <Route path="/bags" element={<PrivateRoute allowedRoles={['dealer', 'admin', 'agent']}><DealerCatalog routeCategory="Bags" /></PrivateRoute>} />
          <Route path="/catalog/:id" element={<PrivateRoute><WatchDetail /></PrivateRoute>} />
          <Route path="/agent" element={<PrivateRoute allowedRoles={['agent', 'admin']}><AgentListings /></PrivateRoute>} />
          <Route path="/admin" element={<PrivateRoute allowedRoles={['admin']}><AdminPanel /></PrivateRoute>} />
          <Route path="/offers" element={<PrivateRoute allowedRoles={['dealer']}><DealerOffers /></PrivateRoute>} />
        </Routes>
      </BrowserRouter>
      </CurrencyProvider>
    </AuthProvider>
  )
}
