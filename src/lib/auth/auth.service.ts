// ============================================================
// SHIKHO QA SYSTEM — Auth Service
// All login / logout / session / profile logic
// ============================================================

import { cache } from 'react'
import { getSupabaseServer } from '@/lib/supabase/server'
import type { AuthUser } from '@/types/database.types'

// ── Get current authenticated user with full profile ─────────
// Wrapped in React's cache(): within ONE request (a page render, its layout,
// the services it calls, or a server action) every caller shares one
// result. Uncached, each call cost two network round trips (Supabase Auth
// getUser + the profile row) and one page made three or four of them.
// Safe because nothing reads the user, changes it, and reads it again in
// the same request (changeOwnPassword reads once). A new request always
// starts fresh, so sign-in/out and deactivation take effect immediately.
export const getAuthUser = cache(async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await getSupabaseServer()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return null

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('*')
    .eq('auth_id', user.id)
    .eq('is_active', true)
    .single()

  if (profileError || !profile) return null

  return {
    id: user.id,
    email: user.email!,
    profile,
    role: profile.role,
  }
})

// ── Sign in with email/password ───────────────────────────────
export async function signIn(email: string, password: string) {
  const supabase = await getSupabaseServer()

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase().trim(),
    password,
  })

  if (error) {
    if (error.message.includes('Invalid login')) {
      return { error: 'Invalid email or password.' }
    }
    if (error.message.includes('Email not confirmed')) {
      return { error: 'Please confirm your email before signing in.' }
    }
    return { error: 'Sign in failed. Please try again.' }
  }

  const { data: profile } = await supabase
    .from('users')
    .select('id, is_active, name')
    .eq('auth_id', data.user.id)
    .single()

  if (!profile) {
    await supabase.auth.signOut()
    return { error: 'Account not found. Contact your administrator.' }
  }

  if (!profile.is_active) {
    await supabase.auth.signOut()
    return { error: 'Your account has been deactivated. Contact your administrator.' }
  }

  return { data: { user: data.user, session: data.session } }
}

// ── Sign out ──────────────────────────────────────────────────
export async function signOut() {
  const supabase = await getSupabaseServer()
  await supabase.auth.signOut()
}

// ── Role-based redirect after login ──────────────────────────
export function getPostLoginRedirect(user: AuthUser): string {
  switch (user.role) {
    case 'super_admin':
    case 'qa_manager':
      return '/dashboard/admin'
    case 'manager':
      return '/dashboard/manager'
    case 'qa_auditor':
      return '/dashboard/auditor'
    case 'team_lead':
      return '/dashboard/team'
    case 'agent':
      return '/dashboard/agent'
    default: {
      // Exhaustiveness check: adding a role without a home page is a
      // compile error here. (A '/dashboard' fallback would redirect
      // straight back into this function and loop forever.)
      const unhandled: never = user.role
      throw new Error(`No home page defined for role "${unhandled}".`)
    }
  }
}
