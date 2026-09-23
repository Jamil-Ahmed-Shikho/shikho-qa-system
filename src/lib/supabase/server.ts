// ============================================================
// SHIKHO QA SYSTEM — Supabase Server Client
// Used in Server Components, Route Handlers, Middleware
// ============================================================

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function getSupabaseServer() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component — cookie setting handled by middleware
          }
        },
      },
    }
  )
}

// Service role client — bypasses RLS
// ONLY used for narrow, system-computed writes a normal session
// shouldn't be broadened to make (e.g. caching users.crm_agent_id in
// src/lib/audits/agent-matching.ts), plus server-side cron jobs and
// report generation.
export function getSupabaseAdmin() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
      auth: { persistSession: false },
    }
  )
}
