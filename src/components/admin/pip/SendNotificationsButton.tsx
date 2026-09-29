'use client'
// §6.4, Section C, Stage 7: manual, mode-gated, idempotent-per-cycle send. Mirrors
// Calibration's SendReportButton exactly (warn-before-resend, TEST MODE wording).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { sendPipNotificationsAction } from '@/lib/pip/actions'
import { primaryBtn, disabledStyle } from '@/components/admin/users/styles'

export function SendNotificationsButton({ cycleId, alreadySentLabel }: { cycleId: string; alreadySentLabel: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function send() {
    const resend = alreadySentLabel !== null
    const q = resend
      ? `Notifications for this cycle were already sent on ${alreadySentLabel}. Send them again?`
      : 'Email every published agent their own PIP notice, and their Team Lead / Manager a summary of their own people?'
    if (!window.confirm(q)) return
    setMessage(null)
    start(async () => {
      const res = await sendPipNotificationsAction(cycleId, resend)
      if (!res.ok) return setMessage({ ok: false, text: res.error })
      const tail = res.failed.length ? ` Could not reach: ${res.failed.join(', ')}.` : ''
      const skippedTail = res.skipped > 0 ? ` (${res.skipped} skipped — not on the test allowlist.)` : ''
      setMessage({
        ok: true,
        text: res.mode === 'test'
          ? `TEST MODE: ${res.sent} test email(s) sent to the configured test allowlist only — no real agent/Team Lead/Manager was emailed.${skippedTail}${tail}`
          : `Sent to ${res.sent} recipient(s).${tail}`,
      })
      router.refresh()
    })
  }

  return (
    <div>
      <button type="button" onClick={send} disabled={pending}
        style={{ ...primaryBtn, ...(pending ? disabledStyle : {}) }}>
        {pending ? 'Sending…' : alreadySentLabel ? 'Send notifications again' : 'Send notifications'}
      </button>
      {message && <div role={message.ok ? 'status' : 'alert'} style={{ fontSize: '13px', marginTop: '8px', color: message.ok ? 'var(--status-green)' : 'var(--alert)' }}>{message.text}</div>}
    </div>
  )
}
