'use server'
// ============================================================
// SHIKHO QA SYSTEM â€” Calibration "Send report" action (Â§5, Stage 4)
// Manual only: a person presses the button on a CLOSED session. Returns
// { ok, error } (never throws, Â§14). Whether anything is really emailed is
// decided by CALIBRATION_REPORT_MODE (see report-runner.ts) â€” off by default.
// ============================================================

import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseAdmin, getSupabaseServer } from '@/lib/supabase/server'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { writeAuditLogs } from '@/lib/users/audit-log'
import { sendCalibrationReportEmail } from '@/lib/users/mailer'
import { getSession, loadAlignment, loadCalibrationRubric, loadReportSentAt, loadResults } from './calibration.service'
import { reportHtml, reportSubject, reportText } from './report-email'
import { parseRecipientList, parseReportMode, runReportSend } from './report-runner'
import { buildVarianceReport } from './variance'
import type { ActionResult } from './actions'

// Override lets local testing point this at a disposable address instead of the real shared
// inbox (same pattern as AUDIT_EMAIL_QA_TEAM_CC, scoring-actions.ts) — unset, it's the real one.
// Only ever added in 'live' mode; 'test' mode stays restricted to CALIBRATION_REPORT_TEST_RECIPIENTS.
const QA_TEAM_EMAIL = (process.env.CALIBRATION_QA_TEAM_CC ?? '').trim() || 'qat@shikho.com'

function hasRealLogin(u: { is_active: boolean | null; account_status: string | null; email: string | null }): boolean {
  return !!u.is_active && u.account_status === 'active' && !!u.email
}

export async function sendReportAction(
  sessionId: string,
  resend: boolean
): Promise<ActionResult<{ sent: number; mode: 'test' | 'live'; failed: string[] }>> {
  try {
    const user = await getAuthUser()
    if (!user) return { ok: false, error: 'You are not signed in.' }
    const supabase = await getSupabaseServer()

    // Released only to the scheduler / QA Manager / Super Admin, and only once the session is closed.
    const rec = await supabase.rpc('calibration_report_recipients', { p_id: sessionId })
    if (rec.error) return { ok: false, error: rec.error.message }
    const people = (rec.data ?? []) as { user_id: string; name: string; email: string; submitted: boolean }[]
    if (people.length === 0) {
      return { ok: false, error: 'Only the scheduler or a QA Manager / Super Admin can send the report, and only after the session is closed.' }
    }

    const found = await getSession(sessionId)
    if (!found) return { ok: false, error: 'That session was not found.' }

    // A "team" session (QA + Team Leads) also reaches each participating Team Lead's own Manager
    // with the final report — not Cc on each participant's email, but their own copy, same as
    // everyone else (Jamil, 2026-10-28). A "qa_only" session has no Team Lead participants, so
    // this is naturally a no-op for it.
    let managerRecipients: { name: string; email: string }[] = []
    if (found.session.kind === 'team') {
      const admin = getSupabaseAdmin()
      const { data: participantUsers } = await admin.from('users').select('id, role, manager_id').in('id', people.map((p) => p.user_id))
      const tlManagerIds = [...new Set((participantUsers ?? []).filter((u) => u.role === 'team_lead' && u.manager_id).map((u) => u.manager_id as string))]
      if (tlManagerIds.length > 0) {
        const { data: managers } = await admin.from('users').select('name, email, is_active, account_status').in('id', tlManagerIds)
        const participantEmails = new Set(people.map((p) => p.email.trim().toLowerCase()))
        managerRecipients = (managers ?? [])
          .filter((m) => hasRealLogin(m) && !participantEmails.has((m.email as string).trim().toLowerCase()))
          .map((m) => ({ name: m.name as string, email: m.email as string }))
      }
    }
    const [results, rubric, sentAt, alignment] = await Promise.all([
      loadResults(sessionId),
      loadCalibrationRubric(found.session.rubricId),
      loadReportSentAt(sessionId),
      loadAlignment(sessionId).catch(() => null),
    ])
    if (!results?.revealed || !rubric) return { ok: false, error: 'The report is not available yet.' }
    if (sentAt && !resend) return { ok: false, error: 'The report was already sent. Confirm to send it again.' }
    const report = buildVarianceReport(results.scores, rubric, alignment?.recorded ? {
      scorePercent: alignment.scorePercent!, criticalFail: alignment.criticalFail!, byName: alignment.byName, at: alignment.at,
      params: alignment.params, fatalIds: alignment.fatalIds,
    } : null)
    if (report.count < 2) return { ok: false, error: 'A report needs at least two submitted scores.' }

    const s = found.session
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? null
    const input = {
      title: s.title ?? (s.itemType === 'call' ? `Call ${s.crmCallId}` : (s.itemReference ?? 'Calibration')),
      whenLabel: formatDhakaDateTime(s.scheduledAt),
      scope: `${s.teamName} Â· ${s.siteName}`,
      rubricName: s.rubricName,
      report,
      notSubmitted: people.filter((p) => !p.submitted).map((p) => p.name),
      url: base ? `${base}/calibration/${s.id}` : null,
    }
    const subject = reportSubject(input)
    const html = reportHtml(input)
    const text = reportText(input)

    const mode = parseReportMode(process.env.CALIBRATION_REPORT_MODE)
    // qat@shikho.com gets its own copy too, live sends only — never in 'test' mode, which stays
    // restricted to CALIBRATION_REPORT_TEST_RECIPIENTS so a dev run can never reach the real inbox.
    const extraRecipients = mode === 'live' ? [...managerRecipients, { name: 'Quality Team', email: QA_TEAM_EMAIL }] : managerRecipients
    const result = await runReportSend({
      mode,
      testRecipients: parseRecipientList(process.env.CALIBRATION_REPORT_TEST_RECIPIENTS),
      recipients: [...people, ...extraRecipients],
      send: (to) => sendCalibrationReportEmail(to, mode === 'test' ? `[TEST] ${subject}` : subject, html, text),
    })
    if (!result.ok) return { ok: false, error: result.error }

    // Only a real send counts as "sent"; a test-mode send leaves the button available for the real one.
    if (result.mode === 'live') {
      const { error } = await getSupabaseAdmin()
        .from('calibration_sessions')
        .update({ report_sent_at: new Date().toISOString(), report_sent_by: user.profile.id })
        .eq('id', sessionId)
      if (error) console.error('calibration report_sent_at not recorded:', error.message)
    }
    await writeAuditLogs([{
      actor_id: user.profile.id,
      action: 'calibration.report_sent',
      table_name: 'calibration_sessions',
      record_id: sessionId,
      after_data: { mode: result.mode, sent: result.sent, failed: result.failed.length, resend, extraManagers: managerRecipients.length, qaTeamCcEmail: result.mode === 'live' ? QA_TEAM_EMAIL : null },
    }])
    revalidatePath(`/calibration/${sessionId}`)
    return { ok: true, sent: result.sent, mode: result.mode, failed: result.failed }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' }
  }
}

