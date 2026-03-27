import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import DealerCatalog from './pages/DealerCatalog'
import WatchDetail from './pages/WatchDetail'
import AgentListings from './pages/AgentListings'
import AdminPanel from './pages/AdminPanel'

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
  if (profile.role === 'agent') return <Navigate to="/agent" replace />
  return <Navigate to="/catalog" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><RoleRedirect /></PrivateRoute>} />
          <Route path="/catalog" element={<PrivateRoute allowedRoles={['dealer','admin']}><DealerCatalog /></PrivateRoute>} />
          <Route path="/catalog/:id" element={<PrivateRoute><WatchDetail /></PrivateRoute>} />
          <Route path="/agent" element={<PrivateRoute allowedRoles={['agent','admin']}><AgentListings /></PrivateRoute>} />
          <Route path="/admin" element={<PrivateRoute allowedRoles={['admin']}><AdminPanel /></PrivateRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
