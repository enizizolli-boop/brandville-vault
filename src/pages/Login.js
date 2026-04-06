import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export default function Login() {
  const { signIn, user, profile } = useAuth()
  const [email, setEmail] = useState(() => localStorage.getItem('bv_saved_email') || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('bv_remember') !== 'false')
  const [showPassword, setShowPassword] = useState(false)
  const [forgotMode, setForgotMode] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  if (user && profile) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password, rememberMe)
    if (error) { setError('Invalid email or password.'); setLoading(false) }
    else {
      if (rememberMe) {
        localStorage.setItem('bv_saved_email', email)
        localStorage.setItem('bv_remember', 'true')
      } else {
        localStorage.removeItem('bv_saved_email')
        localStorage.setItem('bv_remember', 'false')
      }
    }
  }

  async function handleForgot(e) {
    e.preventDefault()
    setForgotLoading(true)
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password'
    })
    setForgotLoading(false)
    setForgotSent(true)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f6f2', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ marginBottom: 36, textAlign: 'center' }}>
          <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 28, fontWeight: 600, letterSpacing: 0.3, marginBottom: 6 }}>
            Brandville <span style={{ color: '#b8965a', fontStyle: 'italic', fontWeight: 500 }}>Vault</span>
          </div>
          <div style={{ fontSize: 12, color: '#b8b0a5', letterSpacing: 0.3 }}>Private catalog — access by invitation only</div>
        </div>
        <div className="card" style={{ padding: '28px 24px' }}>
          {forgotMode ? (
            forgotSent ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Check your email</div>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>We sent a password reset link to <strong>{email}</strong></div>
                <button className="btn btn-sm" onClick={() => { setForgotMode(false); setForgotSent(false) }}>Back to sign in</button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Reset password</div>
                <div style={{ fontSize: 12, color: '#aaa', marginBottom: 16 }}>Enter your email and we'll send you a reset link.</div>
                <form onSubmit={handleForgot}>
                  <div className="form-row">
                    <label>Email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required autoFocus />
                  </div>
                  <button type="submit" className="btn btn-dark btn-full" disabled={forgotLoading} style={{ marginTop: 4 }}>
                    {forgotLoading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Send reset link'}
                  </button>
                </form>
                <div style={{ textAlign: 'center', marginTop: 14 }}>
                  <button onClick={() => setForgotMode(false)} style={{ background: 'none', border: 'none', fontSize: 12, color: '#aaa', cursor: 'pointer' }}>Back to sign in</button>
                </div>
              </>
            )
          ) : (
            <>
              {error && <div className="error-msg">{error}</div>}
              <form onSubmit={handleSubmit}>
                <div className="form-row">
                  <label>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required autoFocus />
                </div>
                <div className="form-row">
                  <label>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required style={{ width: '100%', paddingRight: 40 }} />
                    <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 13, padding: 0 }}>
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0 4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" id="rememberMe" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} style={{ width: 15, height: 15, accentColor: '#b8965a', cursor: 'pointer' }} />
                    <label htmlFor="rememberMe" style={{ fontSize: 13, color: '#666', cursor: 'pointer', userSelect: 'none' }}>Remember me</label>
                  </div>
                  <button type="button" onClick={() => setForgotMode(true)} style={{ background: 'none', border: 'none', fontSize: 12, color: '#b8965a', cursor: 'pointer', padding: 0 }}>Forgot password?</button>
                </div>
                <button type="submit" className="btn btn-dark btn-full" disabled={loading} style={{ marginTop: 4 }}>
                  {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Sign in'}
                </button>
              </form>
            </>
          )}
        </div>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: '#bbb' }}>
          Don't have access? Contact your Brandville representative.
        </div>
      </div>
    </div>
  )
}
