// ============================================================
// SHIKHO QA SYSTEM — Supabase Client
// Singleton pattern — one client instance per environment
// ============================================================

import { createBrowserClient } from '@supabase/ssr'

let client: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseClient() {
  if (client) return client
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  return client
}

export const supabase = getSupabaseClient()
