'use server'
// ============================================================
// SHIKHO QA SYSTEM — Campaign Mistake Report "Send report" action (2026-10-04)
// Manual only: a person presses the button on /reports/campaigns. Returns
// { ok, error } (never throws, §14). Whether anything is really emailed is
// decided by CAMPAIGN_MISTAKE_REPORT_MODE — off by default.
//
// Re-loads everything server-side from the same inputs the page used (never
// trusts client-supplied rows), so what's sent is guaranteed to match what a
// re-run of the exact same report would show.
// ============================================================

import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'
import { sendCampaignMistakeReportEmail } from '@/lib/users/mailer'
import { parseNotifyMode, parseNotifyTestRecipients } from '@/lib/pip/notification-runner'
import { listMistakeOptions, loadCampaignMistakeBreakdown, loadCampaignReport, type ReportFilters } from './report.service'
import { mistakeReportHtml, mistakeReportSubject, mistakeReportText } from './mistake-report-email'

type Fail = { ok: false; error: string }

const DEFAULT_TO = 'dhakaleaders@shikho.com,jashoreleaders@shikho.com'

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

export async function sendMistakeReportAction(
  campaignId: string,
  filters: ReportFilters,
  valueIds: string[] | null
): Promise<{ ok: true; mode: 'test' | 'live'; sentTo: string[] } | Fail> {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager'].includes(user.role)) {
    return { ok: false, error: 'Only Super Admin / QA Manager can send the Campaign Mistake Report.' }
  }

  const [report, rows] = await Promise.all([
    loadCampaignReport(campaignId, filters),
    loadCampaignMistakeBreakdown(campaignId, filters, valueIds),
  ])
  if (!report) return { ok: false, error: 'That campaign no longer exists.' }
  const options = listMistakeOptions(report)
  if (options.length === 0) return { ok: false, error: 'No options in this campaign are tagged as a mistake yet — nothing to report.' }

  const input = {
    campaignName: report.campaignName,
    periodLabel: periodLabel(filters),
    countedAsMistake: options
      .filter((o) => (valueIds === null ? true : valueIds.includes(o.valueId)))
      .map((o) => `${o.checkName} — ${o.label}`),
    rows,
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
      return { ok: true, mode: 'test', sentTo: testRecipients }
    }

    // live: To = the site leadership group mailboxes (overridable for local testing, defaults
    // to the real addresses), Cc = every real Manager/QA Manager/Super Admin.
    const to = ((process.env.CAMPAIGN_MISTAKE_REPORT_TO ?? '').trim() || DEFAULT_TO).split(',').map((s) => s.trim()).filter(Boolean)
    const admin = getSupabaseAdmin()
    const { data: staff, error } = await admin.from('users').select('email, is_active, account_status').in('role', ['manager', 'qa_manager', 'super_admin'])
    if (error) return { ok: false, error: `Could not load the Cc recipient list: ${error.message}` }
    const cc = [...new Set((staff ?? []).filter((u) => u.is_active && u.account_status === 'active' && u.email).map((u) => u.email as string))]

    await sendCampaignMistakeReportEmail(to, cc, subject, html, text)
    await writeAuditLogs([{ actor_id: user.profile.id, action: 'campaign.mistake_report_sent', table_name: 'campaigns', record_id: campaignId, after_data: { mode, to, cc: cc.length } }])
    return { ok: true, mode: 'live', sentTo: to }
  } catch (err) {
    console.error('Campaign mistake report email failed:', err)
    return { ok: false, error: 'The email could not be sent. Check the mail settings and try again.' }
  }
}
