import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Show form immediately if session already exists (redirected here by AuthContext)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleReset(e) {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
    } else {
      setMsg('Password set successfully! Redirecting...')
      setTimeout(() => navigate('/'), 2000)
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f6f3', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5, marginBottom: 4 }}>Brandville <span style={{ color: '#aaa', fontWeight: 400 }}>Vault</span></div>
          <div style={{ fontSize: 13, color: '#aaa' }}>Set your password to access the catalog</div>
        </div>
        <div className="card" style={{ padding: '28px 24px' }}>
          {msg && <div className="success-msg">{msg}</div>}
          {error && <div className="error-msg">{error}</div>}
          {!ready ? (
            <div style={{ textAlign: 'center', color: '#aaa', fontSize: 13 }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              Verifying your link...
            </div>
          ) : (
            <form onSubmit={handleReset}>
              <div className="form-row">
                <label>New password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  autoFocus
                />
              </div>
              <div className="form-row">
                <label>Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  required
                />
              </div>
              <button type="submit" className="btn btn-dark btn-full" disabled={loading}>
                {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Set password & sign in'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
