import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // Track current user id so cross-tab token refreshes don't re-render the app
  const currentUserIdRef = useRef(null)

  useEffect(() => {
    // Safety timeout: if Supabase auth doesn't respond in 5s (e.g. during an
    // outage), stop showing a blank loading screen and render the site anyway.
    const authTimeout = setTimeout(() => {
      console.warn('Auth timed out — rendering unauthenticated')
      setLoading(false)
    }, 5000)

    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(authTimeout)
      currentUserIdRef.current = session?.user?.id ?? null
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Don't log user in — redirect to reset form so they set a new password
        setLoading(false)
        if (window.location.pathname !== '/reset-password') {
          window.location.replace('/reset-password')
        }
        return
      }
      const newUserId = session?.user?.id ?? null
      // supabase-js v2 broadcasts SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED, etc.
      // to every open tab via localStorage. If the user identity hasn't changed,
      // skip the re-render — otherwise opening any new tab looks like a page refresh.
      if (newUserId !== null && newUserId === currentUserIdRef.current) return
      currentUserIdRef.current = newUserId
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data)
    setLoading(false)
  }

  async function signIn(email, password, rememberMe = true) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error && !rememberMe) {
      sessionStorage.setItem('sessionOnly', '1')
    }
    return { error }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut, fetchProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
