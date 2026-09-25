// ============================================================
// SHIKHO QA SYSTEM — Briefings daily digest, the job (§5, Part C)
// Server-only. runBriefingDigest() is the tested logic with every outside
// thing injected (database, clock, mail); runDailyBriefingDigest() wires it
// to the real ones with the service role (a cron call has no signed-in user).
//
// SAFE BY DEFAULT — the mode comes from BRIEFING_DIGEST_MODE and anything
// other than an exact known value means 'off':
//   off      does nothing at all (not even a database read)          <- the default
//   preview  works out who WOULD get what and reports it; sends nothing
//   test     sends ONLY to the addresses in BRIEFING_DIGEST_TEST_RECIPIENTS
//            (an empty list sends to nobody — it fails closed)
//   live     sends to every eligible Team Lead / Manager with sessions
// So deploying the cron cannot email anyone until someone deliberately sets it.
//
// Idempotent per person per day PER MODE: a send is recorded in audit_log
// ('briefing.digest_sent', record = the recipient, after_data.day + mode), and a
// second run of the same mode that day skips anyone already recorded — a retried
// or double-fired cron never double-mails. A 'test' record never blocks a later
// 'live' send (the test went to a test address; the real one still has to go).
// ============================================================

import { renderDigest } from './digest-email'
import { buildDigests, canReceiveDigest, targetDay, type DigestSession, type DigestUser, type TargetDay } from './digest'

export type DigestMode = 'off' | 'preview' | 'test' | 'live'

export function parseMode(v: string | undefined | null): DigestMode {
  const m = (v ?? '').trim().toLowerCase()
  return m === 'preview' || m === 'test' || m === 'live' ? m : 'off'
}

export function parseRecipientList(v: string | undefined | null): string[] {
  return (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@'))
}

export interface DigestDeps {
  now: () => Date
  loadUsers: () => Promise<DigestUser[]>
  loadSessions: (day: TargetDay) => Promise<DigestSession[]>
  alreadySent: (recipientId: string, ymd: string, mode: DigestMode) => Promise<boolean>
  markSent: (recipientId: string, ymd: string, info: { sessions: number; mode: DigestMode }) => Promise<void>
  send: (to: string, subject: string, html: string, text: string) => Promise<void>
}

export interface DigestConfig {
  mode: DigestMode
  /** Only consulted in 'test' mode. Lower-case addresses. */
  testRecipients: string[]
}

export interface DigestRunResult {
  mode: DigestMode
  day: string | null
  eligibleRecipients: number
  withSessions: number
  sent: number
  skippedNothingTomorrow: number
  skippedNotAllowed: number
  skippedAlreadySent: number
  failed: Array<{ recipient: string; error: string }>
  /** preview mode only: who would get how many sessions (names, no addresses). */
  wouldSend: Array<{ name: string; role: string; sessions: number }>
}

const empty = (mode: DigestMode): DigestRunResult => ({
  mode, day: null, eligibleRecipients: 0, withSessions: 0, sent: 0,
  skippedNothingTomorrow: 0, skippedNotAllowed: 0, skippedAlreadySent: 0, failed: [], wouldSend: [],
})

export async function runBriefingDigest(deps: DigestDeps, cfg: DigestConfig): Promise<DigestRunResult> {
  const result = empty(cfg.mode)
  if (cfg.mode === 'off') return result

  const now = deps.now()
  const day = targetDay(now)
  result.day = day.ymd

  const users = await deps.loadUsers()
  const sessions = await deps.loadSessions(day)
  const digests = buildDigests(users, sessions, day)

  result.eligibleRecipients = users.filter(canReceiveDigest).length
  result.withSessions = digests.length
  // Eligible people with nobody briefed that day: deliberately sent nothing (no empty digests).
  result.skippedNothingTomorrow = result.eligibleRecipients - digests.length

  if (cfg.mode === 'preview') {
    result.wouldSend = digests.map((d) => ({ name: d.recipient.name, role: d.recipient.role, sessions: d.total }))
    return result
  }

  const allow = new Set(cfg.testRecipients)
  for (const d of digests) {
    if (cfg.mode === 'test' && !allow.has(d.recipient.email.trim().toLowerCase())) {
      result.skippedNotAllowed++
      continue
    }
    try {
      if (await deps.alreadySent(d.recipient.id, d.ymd, cfg.mode)) {
        result.skippedAlreadySent++
        continue
      }
      const mail = renderDigest(d, now)
      await deps.send(d.recipient.email, mail.subject, mail.html, mail.text)
      result.sent++
      // The mail is out; if recording it fails, say so loudly but don't call the SEND failed.
      await deps.markSent(d.recipient.id, d.ymd, { sessions: d.total, mode: cfg.mode }).catch((err) => {
        console.error(`Digest sent to ${d.recipient.name} but could not be recorded (a rerun may resend):`, err)
      })
    } catch (err) {
      result.failed.push({ recipient: d.recipient.name, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}

// ── production wiring ────────────────────────────────────────

async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

/** The real database + mailer behind the injected dependencies (service role). Shared by the cron and the one-off test script. */
export async function makeProductionDeps(now: () => Date = () => new Date()): Promise<DigestDeps> {
  const { getSupabaseAdmin } = await import('@/lib/supabase/server')
  const { sendBriefingDigestEmail } = await import('@/lib/users/mailer')
  const admin = getSupabaseAdmin()

  const deps: DigestDeps = {
    now,
    loadUsers: async () =>
      selectAll<DigestUser>((from, to) =>
        admin
          .from('users')
          .select('id, name, email, role, is_active, account_status, team_leader_id, manager_id')
          .in('role', ['agent', 'team_lead', 'manager'])
          .order('id')
          .range(from, to)
      ),
    loadSessions: async (day) => {
      const rows = await selectAll<Record<string, unknown>>((from, to) =>
        admin
          .from('briefings')
          .select('id, agent_id, scheduled_at, priority, conductor:users!briefings_conducted_by_fkey(name)')
          .eq('status', 'scheduled')
          .gte('scheduled_at', day.dayStart.toISOString())
          .lt('scheduled_at', day.dayEnd.toISOString())
          .order('id')
          .range(from, to)
      )
      return rows.map((r) => ({
        briefingId: r.id as string,
        agentId: r.agent_id as string,
        scheduledAt: r.scheduled_at as string,
        urgent: r.priority === 'critical_same_day',
        conductorName: (r.conductor as { name: string } | null)?.name ?? null,
      }))
    },
    alreadySent: async (recipientId, ymd, mode) => {
      const { data, error } = await admin
        .from('audit_log')
        .select('id')
        .eq('action', 'briefing.digest_sent')
        .eq('record_id', recipientId)
        .eq('after_data->>day', ymd)
        .eq('after_data->>mode', mode)
        .limit(1)
      if (error) throw new Error(`Could not check whether the digest was already sent: ${error.message}`)
      return (data ?? []).length > 0
    },
    markSent: async (recipientId, ymd, info) => {
      const { error } = await admin.from('audit_log').insert({
        actor_id: null, action: 'briefing.digest_sent', table_name: 'briefings', record_id: recipientId,
        after_data: { day: ymd, sessions: info.sessions, mode: info.mode },
      })
      if (error) throw new Error(error.message)
    },
    send: sendBriefingDigestEmail,
  }
  return deps
}

export async function runDailyBriefingDigest(): Promise<DigestRunResult> {
  const cfg: DigestConfig = {
    mode: parseMode(process.env.BRIEFING_DIGEST_MODE),
    testRecipients: parseRecipientList(process.env.BRIEFING_DIGEST_TEST_RECIPIENTS),
  }
  // 'off' must not touch the database or the mailer at all — the deps (and their imports) are only built when needed.
  if (cfg.mode === 'off') return empty('off')
  return runBriefingDigest(await makeProductionDeps(), cfg)
}
