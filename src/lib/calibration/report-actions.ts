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
import { getSession, loadCalibrationRubric, loadReportSentAt, loadResults } from './calibration.service'
import { reportHtml, reportSubject, reportText } from './report-email'
import { parseRecipientList, parseReportMode, runReportSend } from './report-runner'
import { buildVarianceReport } from './variance'
import type { ActionResult } from './actions'

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
    const people = (rec.data ?? []) as { name: string; email: string; submitted: boolean }[]
    if (people.length === 0) {
      return { ok: false, error: 'Only the scheduler or a QA Manager / Super Admin can send the report, and only after the session is closed.' }
    }

    const found = await getSession(sessionId)
    if (!found) return { ok: false, error: 'That session was not found.' }
    const [results, rubric, sentAt] = await Promise.all([
      loadResults(sessionId),
      loadCalibrationRubric(found.session.rubricId),
      loadReportSentAt(sessionId),
    ])
    if (!results?.revealed || !rubric) return { ok: false, error: 'The report is not available yet.' }
    if (sentAt && !resend) return { ok: false, error: 'The report was already sent. Confirm to send it again.' }
    const report = buildVarianceReport(results.scores, rubric)
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
    const result = await runReportSend({
      mode,
      testRecipients: parseRecipientList(process.env.CALIBRATION_REPORT_TEST_RECIPIENTS),
      recipients: people,
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
      after_data: { mode: result.mode, sent: result.sent, failed: result.failed.length, resend },
    }])
    revalidatePath(`/calibration/${sessionId}`)
    return { ok: true, sent: result.sent, mode: result.mode, failed: result.failed }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' }
  }
}

