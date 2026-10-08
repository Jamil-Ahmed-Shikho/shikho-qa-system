'use server'
// ============================================================
// SHIKHO QA SYSTEM — Campaign Mistake Report "Send report" action (2026-10-04,
// recipient routing corrected same day on Jamil's feedback — see below)
// Manual only: a person presses the button on /reports/campaigns. Returns
// { ok, error } (never throws, §14). Whether anything is really emailed is
// decided by CAMPAIGN_MISTAKE_REPORT_MODE — off by default.
//
// Re-loads everything server-side from the same inputs the page used (never
// trusts client-supplied rows), so what's sent is guaranteed to match what a
// re-run of the exact same report would show.
//
// RECIPIENT ROUTING (confirmed by Jamil, not guessed): dynamic, based on
// which teams/sites the FLAGGED agents (the "Who to take care of" rows)
// actually belong to — not a fixed list.
//   - Telesales, Dhaka  -> To: dhakaleaders@shikho.com (once, if any such agent is flagged)
//   - Telesales, Jashore -> To: jashoreleaders@shikho.com (once, if any such agent is flagged)
//   - Any other team (CX Non-Voice, CX Inbound, Engagement, Retention, TS3P)
//     -> To: each flagged agent's own real Team Lead; Cc: that Team Lead's own Manager
//   - Cc, always: every real QA Manager / Super Admin (company-wide QA leadership)
// If nothing resolves a To address at all (e.g. no mistakes this run), the
// QA-leadership Cc list is used as To instead, so the email never gets sent
// with an empty To.
// ============================================================

import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'
import { sendCampaignMistakeReportEmail } from '@/lib/users/mailer'
import { parseNotifyMode, parseNotifyTestRecipients } from '@/lib/pip/notification-runner'
import { listMistakeOptions, loadCampaignMistakeBreakdown, loadCampaignReport, MISTAKE_REPORT_SEND_ROLES, type MistakeRow, type ReportFilters } from './report.service'
import { mistakeReportHtml, mistakeReportSubject, mistakeReportText } from './mistake-report-email'

type Fail = { ok: false; error: string }

const DHAKA_GROUP = 'dhakaleaders@shikho.com'
const JASHORE_GROUP = 'jashoreleaders@shikho.com'

function hasRealLogin(u: { is_active: boolean | null; account_status: string | null; email: string | null }): boolean {
  return !!u.is_active && u.account_status === 'active' && !!u.email
}

function appUrl(path: string): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  return base ? `${base}${path}` : null
}

function periodLabel(filters: ReportFilters): string {
  if (!filters.from && !filters.to) return 'All time'
  const from = filters.from ? new Date(filters.from + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '…'
  const to = filters.to ? new Date(filters.to + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '…'
  return `${from} – ${to}`
}

/** Dynamic To/Cc for the flagged agents — see the file header for the exact rule. */
async function resolveRecipients(rows: MistakeRow[]): Promise<{ to: string[]; cc: string[] }> {
  const admin = getSupabaseAdmin()

  // QA leadership — always Cc'd, regardless of who's flagged.
  const { data: leadership } = await admin.from('users').select('email, is_active, account_status').in('role', ['qa_manager', 'super_admin'])
  const qaLeadershipEmails = [...new Set((leadership ?? []).filter(hasRealLogin).map((u) => u.email as string))]

  const to = new Set<string>()
  const ccSet = new Set<string>(qaLeadershipEmails)

  if (rows.length > 0) {
    const agentIds = [...new Set(rows.map((r) => r.agentId))]
    const { data: agents } = await admin.from('users').select('id, team_name, site_name, team_leader_id').in('id', agentIds)

    const otherTeamLeaderIds = new Set<string>()
    for (const a of agents ?? []) {
      if (a.team_name === 'Telesales' && a.site_name === 'Dhaka') to.add(DHAKA_GROUP)
      else if (a.team_name === 'Telesales' && a.site_name === 'Jashore') to.add(JASHORE_GROUP)
      else if (a.team_leader_id) otherTeamLeaderIds.add(a.team_leader_id)
    }

    if (otherTeamLeaderIds.size > 0) {
      const { data: tls } = await admin.from('users').select('id, email, is_active, account_status, manager_id').in('id', [...otherTeamLeaderIds])
      for (const tl of tls ?? []) {
        if (hasRealLogin(tl)) to.add(tl.email as string)
      }
      const managerIds = [...new Set((tls ?? []).map((t) => t.manager_id).filter((id): id is string => !!id))]
      if (managerIds.length > 0) {
        const { data: managers } = await admin.from('users').select('email, is_active, account_status').in('id', managerIds)
        for (const m of managers ?? []) {
          if (hasRealLogin(m)) ccSet.add(m.email as string)
        }
      }
    }
  }

  // Nothing resolved a To (no mistakes this run, or no resolvable addresses) — fall back to
  // the QA leadership list as To rather than ever sending with an empty To.
  if (to.size === 0) {
    for (const e of qaLeadershipEmails) to.add(e)
    return { to: [...to], cc: [] }
  }
  return { to: [...to], cc: [...ccSet] }
}

export async function sendMistakeReportAction(
  campaignId: string,
  filters: ReportFilters,
  valueIds: string[] | null
): Promise<{ ok: true; mode: 'test' | 'live'; sentTo: string[]; cc: string[] } | Fail> {
  const user = await getAuthUser()
  if (!user || !(MISTAKE_REPORT_SEND_ROLES as readonly string[]).includes(user.role)) {
    return { ok: false, error: 'Only Super Admin, QA Manager or QA Auditor can send the Special Check Mistake Report.' }
  }

  const [report, mistakeRows] = await Promise.all([
    loadCampaignReport(campaignId, filters),
    loadCampaignMistakeBreakdown(campaignId, filters, valueIds),
  ])
  if (!report) return { ok: false, error: 'That Special Check no longer exists.' }
  const options = listMistakeOptions(report)
  if (options.length === 0) return { ok: false, error: 'No options in this Special Check are tagged as a mistake yet — nothing to report.' }

  const input = {
    campaignName: report.campaignName,
    campaignArchived: report.campaignArchived,
    auditCount: report.auditCount,
    checks: report.checks,
    periodLabel: periodLabel(filters),
    countedAsMistake: options
      .filter((o) => (valueIds === null ? true : valueIds.includes(o.valueId)))
      .map((o) => `${o.checkName} — ${o.label}`),
    mistakeRows,
    url: appUrl(`/reports/campaigns?campaign=${campaignId}`),
  }
  const subject = mistakeReportSubject(input)
  const html = mistakeReportHtml(input)
  const text = mistakeReportText(input)

  const mode = parseNotifyMode(process.env.CAMPAIGN_MISTAKE_REPORT_MODE)
  if (mode === 'off') return { ok: false, error: 'Report emails are switched off (CAMPAIGN_MISTAKE_REPORT_MODE is not set). Nothing was sent.' }

  try {
    if (mode === 'test') {
      const testRecipients = parseNotifyTestRecipients(process.env.CAMPAIGN_MISTAKE_REPORT_TEST_RECIPIENTS)
      if (testRecipients.length === 0) return { ok: false, error: 'Test mode has no test recipients configured (CAMPAIGN_MISTAKE_REPORT_TEST_RECIPIENTS). Nothing was sent.' }
      await sendCampaignMistakeReportEmail(testRecipients, [], `[TEST] ${subject}`, html, text)
      await writeAuditLogs([{ actor_id: user.profile.id, action: 'campaign.mistake_report_sent', table_name: 'campaigns', record_id: campaignId, after_data: { mode, to: testRecipients } }])
      return { ok: true, mode: 'test', sentTo: testRecipients, cc: [] }
    }

    const { to, cc } = await resolveRecipients(mistakeRows)
    await sendCampaignMistakeReportEmail(to, cc, subject, html, text)
    await writeAuditLogs([{ actor_id: user.profile.id, action: 'campaign.mistake_report_sent', table_name: 'campaigns', record_id: campaignId, after_data: { mode, to, cc } }])
    return { ok: true, mode: 'live', sentTo: to, cc }
  } catch (err) {
    console.error('Campaign mistake report email failed:', err)
    return { ok: false, error: 'The email could not be sent. Check the mail settings and try again.' }
  }
}

// ── Send log (2026-10-08, Jamil's own request: "we may need a log report
// when we last send this report") ───────────────────────────────────────
// Reads the same audit_log rows writeAuditLogs() above already writes —
// no new table. Scoped to this one campaign (table_name='campaigns',
// record_id=campaignId, action='campaign.mistake_report_sent'), newest
// first, capped at 10. Uses the service-role client (audit_log's own RLS
// only lets an admin SELECT, schema_001) — safe here because this function
// is only ever called from a page already gated by requireReportAccess(),
// and it exposes nothing beyond what the Send button itself already shows
// the person who presses it (who/when/mode/recipients of a report send).

export interface MistakeReportSendLogEntry {
  sentAt: string
  sentByName: string
  mode: 'test' | 'live'
  to: string[]
  cc: string[]
}

export async function loadMistakeReportSendLog(campaignId: string, limit = 10): Promise<MistakeReportSendLogEntry[]> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('audit_log')
    .select('actor_id, created_at, after_data')
    .eq('table_name', 'campaigns')
    .eq('record_id', campaignId)
    .eq('action', 'campaign.mistake_report_sent')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('loadMistakeReportSendLog failed:', error.code, error.message)
    return []
  }
  const rows = (data ?? []) as { actor_id: string | null; created_at: string; after_data: { mode?: 'test' | 'live'; to?: string[]; cc?: string[] } | null }[]
  if (rows.length === 0) return []

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((id): id is string => !!id))]
  const { data: actors } = actorIds.length > 0
    ? await admin.from('users').select('id, name').in('id', actorIds)
    : { data: [] as { id: string; name: string }[] }
  const nameById = new Map((actors ?? []).map((a) => [a.id, a.name]))

  return rows.map((r) => ({
    sentAt: r.created_at,
    sentByName: (r.actor_id && nameById.get(r.actor_id)) ?? 'Unknown',
    mode: r.after_data?.mode ?? 'live',
    to: r.after_data?.to ?? [],
    cc: r.after_data?.cc ?? [],
  }))
}
