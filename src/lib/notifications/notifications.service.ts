// ============================================================
// SHIKHO QA SYSTEM — In-app notifications (schema_064, 2026-10-02)
// Five triggers only, nothing generic (see schema_064's own header):
// audit submitted -> agent; Red/critical-fatal -> Manager + every QA
// Manager; calibration scheduled -> each invited participant; a Review
// Request landing on someone's desk -> whoever now holds it.
//
// Coaching-session reminders are NOT stored rows — Vercel Hobby's 2 cron
// jobs are already both spoken for (revenue sync, briefing digest), so a
// third timed job isn't available. Computed here instead, at read time,
// straight from `briefings` for any session starting within the next 2
// hours — shown to both the agent and the conductor, through the SAME
// RLS-respecting session client each already reads their own briefings
// with (agent_id = self / conducted_by = self), so this needs no service
// role and no new read policy.
// ============================================================

import { getSupabaseAdmin, getSupabaseServer } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/auth/auth.service'

export type NotificationType = 'audit_submitted' | 'audit_red_fatal' | 'calibration_scheduled' | 'review_request_landed'

export interface NewNotification {
  recipientId: string
  type: NotificationType
  title: string
  body: string
  link?: string | null
  relatedTable?: string | null
  relatedId?: string | null
}

export interface NotificationItem {
  id: string
  type: NotificationType | 'coaching_reminder'
  title: string
  body: string
  link: string | null
  readAt: string | null
  createdAt: string
  /** Virtual (computed, not a stored row) — e.g. an upcoming coaching-session reminder. Can't be marked read. */
  virtual?: boolean
}

const REMINDER_WINDOW_MINUTES = 120

/** Write one or more notifications with the service role — the only writer (no insert policy for
 * any signed-in role, schema_064). Never lets a notification failure break the caller's real work
 * (submitting an audit, scheduling a session, filing a review) — logged loudly, not thrown. */
export async function createNotifications(rows: NewNotification[]): Promise<void> {
  if (rows.length === 0) return
  const admin = getSupabaseAdmin()
  const { error } = await admin.from('notifications').insert(
    rows.map((r) => ({
      recipient_id: r.recipientId,
      type: r.type,
      title: r.title,
      body: r.body,
      link: r.link ?? null,
      related_table: r.relatedTable ?? null,
      related_id: r.relatedId ?? null,
    }))
  )
  if (error) console.error('notifications insert failed:', error.message)
}

function minutesAway(iso: string, now: Date): number {
  return (new Date(iso).getTime() - now.getTime()) / 60000
}

function formatSlot(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka',
  }).format(new Date(iso))
}

/** The signed-in user's own notifications: real stored rows (newest first, capped) plus any
 * virtual coaching-session reminder due soon. Throws on a genuine read failure (§14 — never let a
 * failed read look like "nothing to show"); the caller decides how to present that. */
export async function loadMyNotifications(limit = 30): Promise<NotificationItem[]> {
  const user = await getAuthUser()
  if (!user) return []
  const supabase = await getSupabaseServer()

  const { data: rows, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, link, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Could not load notifications: ${error.message}`)

  const stored: NotificationItem[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    type: r.type as NotificationType,
    title: r.title as string,
    body: r.body as string,
    link: r.link as string | null,
    readAt: r.read_at as string | null,
    createdAt: r.created_at as string,
  }))

  // Virtual coaching reminders — only agent/QA-staff roles ever have briefings pointing at them.
  if (['agent', 'qa_auditor', 'qa_manager', 'super_admin'].includes(user.role)) {
    const now = new Date()
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60000).toISOString()
    const nowIso = now.toISOString()
    const asAgent = user.role === 'agent'
    const column = asAgent ? 'agent_id' : 'conducted_by'
    const { data: upcoming, error: bErr } = await supabase
      .from('briefings')
      .select('id, scheduled_at, agent_id, conducted_by, users!briefings_agent_id_fkey(name), conductor:users!briefings_conducted_by_fkey(name)')
      .eq(column, user.profile.id)
      .eq('status', 'scheduled')
      .gte('scheduled_at', nowIso)
      .lte('scheduled_at', windowEnd)
    if (bErr) throw new Error(`Could not check upcoming coaching sessions: ${bErr.message}`)

    type OneOrMany<T> = T | T[] | null
    const one = <T,>(v: OneOrMany<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v)
    for (const b of upcoming ?? []) {
      const mins = Math.max(0, Math.round(minutesAway(b.scheduled_at as string, now)))
      const when = formatSlot(b.scheduled_at as string)
      const other = asAgent
        ? one(b.conductor as OneOrMany<{ name: string }>)?.name
        : one(b.users as OneOrMany<{ name: string }>)?.name
      stored.push({
        id: `briefing-${b.id}`,
        type: 'coaching_reminder',
        title: mins <= 15 ? 'Coaching session starting soon' : 'Upcoming coaching session',
        body: asAgent
          ? `Your coaching session with ${other ?? 'QA'} is ${when} (in about ${mins} min).`
          : `Your coaching session with ${other ?? 'the agent'} is ${when} (in about ${mins} min).`,
        link: null,
        readAt: null,
        createdAt: nowIso,
        virtual: true,
      })
    }
  }

  return stored.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function countUnreadNotifications(): Promise<number> {
  const items = await loadMyNotifications(50)
  return items.filter((n) => !n.readAt).length
}

/** Only ever touches the caller's own rows (RLS: recipient_id = self) and only ever sets read_at —
 * a virtual id (no real row) is silently skipped, not an error. */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  const real = ids.filter((id) => !id.startsWith('briefing-'))
  if (real.length === 0) return
  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', real).is('read_at', null)
  if (error) throw new Error(`Could not mark notifications read: ${error.message}`)
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await getSupabaseServer()
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
  if (error) throw new Error(`Could not mark notifications read: ${error.message}`)
}
