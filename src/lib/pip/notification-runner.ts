// ============================================================
// SHIKHO QA SYSTEM — PIP publish notifications, the send (§6.4, Section C, Stage 7)
//
// SAFE BY DEFAULT — PIP_NOTIFICATIONS_MODE; anything other than an exact known value is 'off':
//   off    nothing is sent                                                    <- the default
//   test   sends ONLY to recipients whose email is in PIP_NOTIFICATIONS_TEST_RECIPIENTS
//   live   sends to every eligible recipient (agents + their Team Lead/Manager)
// Notifications are sent only by a person pressing "Send notifications" on a published
// cycle — never automatically on publish.
// ============================================================

export type NotifyMode = 'off' | 'test' | 'live'

export function parseNotifyMode(v: string | undefined | null): NotifyMode {
  const m = (v ?? '').trim().toLowerCase()
  return m === 'test' || m === 'live' ? m : 'off'
}

export function parseNotifyTestRecipients(v: string | undefined | null): string[] {
  return (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@'))
}

export interface NotifyTarget {
  email: string
  send: () => Promise<void>
}

export interface NotifySendResult {
  mode: NotifyMode
  sent: number
  skippedNotAllowed: number
  failed: string[]
}

/** Generic over agent + staff notifications alike -- each target already knows how to send itself. */
export async function runNotifySend(mode: NotifyMode, testRecipients: string[], targets: NotifyTarget[]): Promise<NotifySendResult> {
  const result: NotifySendResult = { mode, sent: 0, skippedNotAllowed: 0, failed: [] }
  if (mode === 'off') return result
  const allow = new Set(testRecipients)
  for (const t of targets) {
    if (mode === 'test' && !allow.has(t.email.trim().toLowerCase())) {
      result.skippedNotAllowed++
      continue
    }
    try {
      await t.send()
      result.sent++
    } catch {
      result.failed.push(t.email)
    }
  }
  return result
}
