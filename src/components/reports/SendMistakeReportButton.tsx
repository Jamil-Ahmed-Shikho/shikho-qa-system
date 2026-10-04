'use client'

import { useState, useTransition } from 'react'
import { sendMistakeReportAction } from '@/lib/campaigns/mistake-report-actions'
import type { ReportFilters } from '@/lib/campaigns/report.service'

export function SendMistakeReportButton({ campaignId, filters, valueIds }: { campaignId: string; filters: ReportFilters; valueIds: string[] | null }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function send() {
    if (!window.confirm('Email this full report (the answer breakdown plus "Who to take care of") to the relevant leadership for the agents flagged below — the Dhaka/Jashore Telesales groups or each agent’s own Team Lead/Manager, as applicable, Cc’d to QA leadership?')) return
    setMessage(null)
    start(async () => {
      const res = await sendMistakeReportAction(campaignId, filters, valueIds)
      if (!res.ok) return setMessage({ ok: false, text: res.error })
      const ccTail = res.cc.length ? ` Cc: ${res.cc.join(', ')}.` : ''
      setMessage({
        ok: true,
        text: res.mode === 'test'
          ? `TEST MODE: sent to the configured test address(es) only — ${res.sentTo.join(', ')}.`
          : `Sent to ${res.sentTo.join(', ')}.${ccTail}`,
      })
    })
  }

  return (
    <div style={{ marginTop: '14px' }}>
      <button type="button" onClick={send} disabled={pending}
        style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--brand)', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: pending ? 'wait' : 'pointer' }}>
        {pending ? 'Sending…' : 'Send report'}
      </button>
      {message && <div role={message.ok ? 'status' : 'alert'} style={{ fontSize: '13px', marginTop: '8px', color: message.ok ? 'var(--status-green)' : 'var(--alert)' }}>{message.text}</div>}
    </div>
  )
}
