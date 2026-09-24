import { callStatusPresentation } from '@/lib/crm/call-status'

/** The CRM's call outcome as a pill — Answer in Primary Indigo, No Answer in Alert Coral. */
export function CallStatusPill({ status }: { status: string | null | undefined }) {
  const p = callStatusPresentation(status)
  return (
    <span style={{
      fontSize: '11px', fontWeight: 600, padding: '2px 10px', borderRadius: 'var(--radius-pill)',
      background: p.bg, color: p.color, whiteSpace: 'nowrap',
    }}>
      {p.label}
    </span>
  )
}
