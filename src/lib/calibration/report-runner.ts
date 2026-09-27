// ============================================================
// SHIKHO QA SYSTEM — Calibration results email, the send (§5, Stage 4)
// Every outside thing is injected so the rules are testable without SMTP.
//
// SAFE BY DEFAULT — CALIBRATION_REPORT_MODE; anything other than an exact known value is 'off':
//   off    nothing is sent                                              <- the default
//   test   sends ONLY to the addresses in CALIBRATION_REPORT_TEST_RECIPIENTS (empty = nobody)
//   live   sends to every participant of the session
// The report is only ever sent by a person pressing "Send report" — never automatically.
// ============================================================

export type ReportMode = 'off' | 'test' | 'live'

export function parseReportMode(v: string | undefined | null): ReportMode {
  const m = (v ?? '').trim().toLowerCase()
  return m === 'test' || m === 'live' ? m : 'off'
}

export function parseRecipientList(v: string | undefined | null): string[] {
  return (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@'))
}

export interface ReportRecipient {
  name: string
  email: string
}

export interface ReportSendInput {
  mode: ReportMode
  testRecipients: string[]
  recipients: ReportRecipient[]
  send: (to: string) => Promise<void>
}

export type ReportSendResult =
  | { ok: true; mode: 'test' | 'live'; sent: number; failed: string[] }
  | { ok: false; error: string }

export async function runReportSend(input: ReportSendInput): Promise<ReportSendResult> {
  if (input.mode === 'off') {
    return { ok: false, error: 'Report emails are switched off (CALIBRATION_REPORT_MODE is not set). Nothing was sent.' }
  }
  const targets =
    input.mode === 'test'
      ? [...new Set(input.testRecipients)].map((email) => ({ name: email, email }))
      : dedupe(input.recipients)
  if (targets.length === 0) {
    return {
      ok: false,
      error:
        input.mode === 'test'
          ? 'Test mode has no test recipients configured (CALIBRATION_REPORT_TEST_RECIPIENTS). Nothing was sent.'
          : 'This session has no recipients.',
    }
  }
  let sent = 0
  const failed: string[] = []
  for (const t of targets) {
    try {
      await input.send(t.email)
      sent++
    } catch {
      failed.push(t.name)
    }
  }
  if (sent === 0) return { ok: false, error: 'The email could not be sent to anyone. Check the mail settings and try again.' }
  return { ok: true, mode: input.mode, sent, failed }
}

function dedupe(rs: ReportRecipient[]): ReportRecipient[] {
  const seen = new Set<string>()
  return rs.filter((r) => {
    const k = r.email.trim().toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}
