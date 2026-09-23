'use client'
// ============================================================
// SHIKHO QA SYSTEM — Auth Hook & Context
// Provides current user throughout the React component tree
// ============================================================

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { supabase } from '@/lib/supabase/client'
import type { AuthUser } from '@/types/database.types'

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchUserProfile(authId: string): Promise<AuthUser | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('auth_id', authId)
    .eq('is_active', true)
    .single()

  if (error || !data) return null

  const sessionUser = (await supabase.auth.getUser()).data.user
  if (!sessionUser) return null

  return {
    id: sessionUser.id,
    email: sessionUser.email!,
    profile: data,
    role: data.role,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      setUser(null)
      return
    }
    const profile = await fetchUserProfile(authUser.id)
    setUser(profile)
  }, [])

  useEffect(() => {
    refreshUser().finally(() => setLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          const profile = await fetchUserProfile(session.user.id)
          setUser(profile)
        } else if (event === 'SIGNED_OUT') {
          setUser(null)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [refreshUser])

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    window.location.href = '/auth/login'
  }

  return (
    <AuthContext.Provider value={{ user, loading, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function useUser(): AuthUser {
  const { user } = useAuth()
  if (!user) throw new Error('useUser called without authenticated user')
  return user
}

// Check if user's role is one of the given roles
export function useRole(...roles: string[]): boolean {
  const { user } = useAuth()
  if (!user) return false
  return roles.includes(user.role)
}
