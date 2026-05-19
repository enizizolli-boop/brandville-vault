import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Signup() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Please enter your full name.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true)

    // Check for existing email before attempting signup
    const { data: existing } = await supabase.from('profiles').select('id').eq('email', email.toLowerCase().trim()).maybeSingle()
    if (existing) { setError('An account with this email already exists. Please sign in.'); setLoading(false); return }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name.trim() } },
    })
    if (signUpError) {
      const msg = signUpError.message.toLowerCase()
      if (msg.includes('already registered') || msg.includes('already exists')) {
        setError('An account with this email already exists. Please sign in.')
      } else {
        setError(signUpError.message)
      }
      setLoading(false)
      return
    }

    // Profile is created automatically by the database trigger (handle_new_user)
    // Fallback insert in case trigger is not set up
    const userId = data?.user?.id
    if (userId) {
      await supabase.from('profiles').upsert(
        { id: userId, full_name: name.trim(), email: email.toLowerCase().trim(), role: 'dealer' },
        { onConflict: 'id' }
      )
    }

    setLoading(false)

    // If session exists, email confirmation is disabled — redirect straight to catalog
    if (data?.session) {
      navigate('/catalog')
    } else {
      setDone(true)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ marginBottom: 36, textAlign: 'center' }}>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 400, letterSpacing: 0.3, marginBottom: 6, color: 'var(--text)' }}>
            Brandville <span style={{ color: 'var(--gold)', fontStyle: 'italic' }}>Vault</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: 0.3 }}>Create your account</div>
        </div>
        <div className="card" style={{ padding: '28px 24px' }}>
          {done ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Account created</div>
              <div style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>
                Check your email at <strong>{email}</strong> to confirm your account, then sign in.
              </div>
              <button className="btn btn-dark btn-full" onClick={() => navigate('/login')}>Go to sign in</button>
            </div>
          ) : (
            <>
              {error && <div className="error-msg">{error}</div>}
              <form onSubmit={handleSubmit}>
                <div className="form-row">
                  <label>Full name</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required autoFocus />
                </div>
                <div className="form-row">
                  <label>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required />
                </div>
                <div className="form-row">
                  <label>Password</label>
                  <div style={{ position: 'relative' }}>
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" required style={{ width: '100%', paddingRight: 40 }} />
                    <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 13, padding: 0 }}>
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                <button type="submit" className="btn btn-dark btn-full" disabled={loading} style={{ marginTop: 4 }}>
                  {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Create account'}
                </button>
              </form>
            </>
          )}
        </div>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: '#bbb' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: '#b8965a', textDecoration: 'none' }}>Sign in</Link>
        </div>
      </div>
    </div>
  )
}
