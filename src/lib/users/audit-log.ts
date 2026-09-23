// ============================================================
// SHIKHO QA SYSTEM — audit_log writer (§1: every write is logged)
// Server-only. Inserts go through the service-role client — the
// audit_log RLS policy (schema_001) only allows admins to SELECT and
// nobody to write via a normal session, keeping it append-only.
// ============================================================

import { getSupabaseAdmin } from '@/lib/supabase/server'

export interface AuditLogEntry {
  actor_id: string
  action: string
  table_name: string
  record_id: string | null
  before_data?: unknown
  after_data?: unknown
}

export async function writeAuditLogs(entries: AuditLogEntry[]) {
  if (entries.length === 0) return
  const admin = getSupabaseAdmin()
  const { error } = await admin.from('audit_log').insert(
    entries.map((e) => ({
      actor_id: e.actor_id,
      action: e.action,
      table_name: e.table_name,
      record_id: e.record_id,
      before_data: e.before_data ?? null,
      after_data: e.after_data ?? null,
    }))
  )
  // The write being logged has already happened — don't fail the
  // caller's request over a log failure, but make it loud in server logs.
  if (error) console.error('audit_log insert failed:', error.message)
}
