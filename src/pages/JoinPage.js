import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const SUPABASE_URL = 'https://tulqgebsvpxgwocptnmy.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1bHFnZWJzdnB4Z3dvY3B0bm15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjYzOTEsImV4cCI6MjA5MDIwMjM5MX0.H12dPM59cIxlvpR7jbuDjpX11qNdohvi-nhiMxNheJA'

export default function JoinPage() {
  const { token } = useParams()
  const [valid, setValid] = useState(null) // null=checking, true=ok, 'used'=already used, false=invalid
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    async function validate() {
      const { data } = await supabase.from('invite_tokens').select('used').eq('token', token).single()
      if (!data) setValid(false)
      else if (data.used) setValid('used')
      else setValid(true)
    }
    if (token) validate()
    else setValid(false)
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.password !== form.confirm) { setError('Passwords do not match'); return }
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return }
    setError(''); setLoading(true)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/join-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ token, email: form.email, password: form.password, full_name: form.full_name, phone: form.phone })
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to create account')
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 400, letterSpacing: 0.3, marginBottom: 6, color: 'var(--text)' }}>
            Brandville <span style={{ color: 'var(--gold)', fontStyle: 'italic' }}>Vault</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: 0.3 }}>Private catalog — access by invitation only</div>
        </div>

        {valid === null && (
          <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
        )}

        {valid === false && (
          <div className="card" style={{ padding: '28px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Invalid invite link</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>This link doesn't exist. Ask your contact to generate a new one.</div>
          </div>
        )}

        {valid === 'used' && (
          <div className="card" style={{ padding: '28px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Link already used</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>This invite link has already been used. Ask your contact to generate a new one.</div>
          </div>
        )}

        {valid === true && !done && (
          <div className="card" style={{ padding: '28px 24px' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Create your account</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>You've been invited to Brandville Vault.</div>
            {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <label>Full name</label>
                <input type="text" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jean Michel" required />
              </div>
              <div className="form-row">
                <label>Email address</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="you@example.com" required />
              </div>
              <div className="form-row">
                <label>Phone number</label>
                <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1 555 000 0000" />
              </div>
              <div className="form-row">
                <label>Password</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Min. 8 characters" required />
              </div>
              <div className="form-row">
                <label>Confirm password</label>
                <input type="password" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} placeholder="Repeat password" required />
              </div>
              <button type="submit" className="btn btn-dark btn-full" disabled={loading} style={{ marginTop: 4 }}>
                {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Create account'}
              </button>
            </form>
          </div>
        )}

        {done && (
          <div className="card" style={{ padding: '28px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Account created!</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Your account is ready. You can now sign in.</div>
            <a href="/login" className="btn btn-dark btn-full" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>Go to sign in</a>
          </div>
        )}
      </div>
    </div>
  )
}
