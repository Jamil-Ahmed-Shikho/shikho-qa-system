'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { sendReportAction } from '@/lib/calibration/report-actions'

export function SendReportButton({ id, alreadySentLabel, participantCount }: { id: string; alreadySentLabel: string | null; participantCount: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function send() {
    const resend = alreadySentLabel !== null
    const q = resend
      ? `The report was already sent on ${alreadySentLabel}. Send it again to all ${participantCount} participants?`
      : `Email the variance report to all ${participantCount} participants?`
    if (!window.confirm(q)) return
    setMessage(null)
    start(async () => {
      const res = await sendReportAction(id, resend)
      if (!res.ok) return setMessage({ ok: false, text: res.error })
      const tail = res.failed.length ? ` Could not reach: ${res.failed.join(', ')}.` : ''
      setMessage({
        ok: true,
        text: res.mode === 'test'
          ? `TEST MODE: ${res.sent} test email(s) sent to the configured test addresses only — no participant was emailed.${tail}`
          : `Sent to ${res.sent} participant(s).${tail}`,
      })
      router.refresh()
    })
  }

  return (
    <div>
      <button type="button" onClick={send} disabled={pending}
        style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--brand)', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: pending ? 'wait' : 'pointer' }}>
        {pending ? 'Sending…' : alreadySentLabel ? 'Send report again' : 'Send report'}
      </button>
      {message && <div role={message.ok ? 'status' : 'alert'} style={{ fontSize: '13px', marginTop: '8px', color: message.ok ? 'var(--status-green)' : 'var(--alert)' }}>{message.text}</div>}
    </div>
  )
}
