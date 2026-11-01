import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { EXPORT_PERIOD_OPTIONS, ExportRangeError, parseExportPeriod, resolveExportRange, type ExportPeriod } from '@/lib/audit-export/period'
import { describeRange } from '@/lib/dates/sales-week'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '20px' }
const sectionTitle: React.CSSProperties = { fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }

function chipStyle(selected: boolean): React.CSSProperties {
  return {
    padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)',
    borderWidth: '1px', borderStyle: 'solid', borderColor: selected ? 'var(--brand)' : 'var(--border)',
    background: selected ? 'var(--brand)' : 'transparent', color: selected ? '#fff' : 'inherit',
  }
}

export default async function AuditExportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; view?: string; from?: string; to?: string }>
}) {
  const user = await getAuthUser()
  const sp = await searchParams
  const period = parseExportPeriod(sp.period)
  const showViewToggle = user?.role === 'qa_auditor'
  const view: QaRankingView = sp.view === 'team' ? 'team' : 'mine'

  let range: { from: Date; to: Date } | null = null
  let rangeError: string | null = null
  try {
    range = resolveExportRange(period, sp.from, sp.to)
  } catch (err) {
    if (err instanceof ExportRangeError) rangeError = err.message
    else throw err
  }

  const makeHref = (p: ExportPeriod, extra?: { from?: string; to?: string }) => {
    const params = new URLSearchParams()
    params.set('period', p)
    if (showViewToggle) params.set('view', view)
    if (p === 'custom') {
      if (extra?.from ?? sp.from) params.set('from', extra?.from ?? sp.from!)
      if (extra?.to ?? sp.to) params.set('to', extra?.to ?? sp.to!)
    }
    return `/reports/audit-export?${params.toString()}`
  }

  const downloadHref = (() => {
    const params = new URLSearchParams()
    params.set('period', period)
    params.set('view', view)
    if (period === 'custom') {
      if (sp.from) params.set('from', sp.from)
      if (sp.to) params.set('to', sp.to)
    }
    return `/api/reports/audit-export?${params.toString()}`
  })()

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Raw Audit Data Export</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
        Download submitted audits as an Excel file — call details, scores, and the specific feedback behind each one.
      </p>

      {showViewToggle && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }} role="tablist" aria-label="Scope">
          <Link href={makeHref(period)} style={chipStyle(view === 'mine')} aria-current={view === 'mine' ? 'page' : undefined}>
            My view
          </Link>
          <Link
            href={(() => { const p = new URLSearchParams(); p.set('period', period); p.set('view', 'team'); if (period === 'custom') { if (sp.from) p.set('from', sp.from); if (sp.to) p.set('to', sp.to) }; return `/reports/audit-export?${p.toString()}` })()}
            style={chipStyle(view === 'team')} aria-current={view === 'team' ? 'page' : undefined}
          >
            Team view
          </Link>
        </div>
      )}

      <div style={card}>
        <h2 style={sectionTitle}>Period</h2>
        <p style={sectionNote}>
          {user?.role === 'team_lead' && 'Your own team only. '}
          {user?.role === 'manager' && 'Your own reporting chain only. '}
          {user?.role === 'qa_auditor' && (view === 'mine' ? 'Your own assigned agents only. ' : 'Every agent, company-wide. ')}
          {(user?.role === 'super_admin' || user?.role === 'qa_manager') && 'Every agent, company-wide. '}
          A custom range can cover at most 30 days at a time.
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }} role="tablist" aria-label="Period">
          {EXPORT_PERIOD_OPTIONS.map((p) => (
            <Link key={p.value} href={makeHref(p.value)} style={chipStyle(period === p.value)} aria-current={period === p.value ? 'page' : undefined}>
              {p.label}
            </Link>
          ))}
        </div>

        {period === 'custom' && (
          <form method="GET" action="/reports/audit-export" style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '14px' }}>
            <input type="hidden" name="period" value="custom" />
            {showViewToggle && <input type="hidden" name="view" value={view} />}
            <label style={{ fontSize: '13px' }}>
              From<br />
              <input type="date" name="from" defaultValue={sp.from ?? ''} style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }} />
            </label>
            <label style={{ fontSize: '13px' }}>
              To<br />
              <input type="date" name="to" defaultValue={sp.to ?? ''} style={{ padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }} />
            </label>
            <button type="submit" style={{ padding: '7px 16px', fontSize: '13px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--surface-1)', cursor: 'pointer' }}>
              Apply
            </button>
          </form>
        )}

        {rangeError ? (
          <p role="alert" style={{ color: 'var(--alert)', fontSize: '13px', margin: 0 }}>{rangeError}</p>
        ) : range ? (
          <>
            <p style={{ fontSize: '13px', margin: '0 0 14px' }}>
              Selected range: <b>{describeRange(range)}</b>
            </p>
            <a
              href={downloadHref}
              style={{ display: 'inline-block', padding: '10px 20px', fontSize: '14px', fontWeight: 600, borderRadius: 'var(--radius-sm)', background: 'var(--brand)', color: '#fff', textDecoration: 'none' }}
            >
              Download Excel (.xlsx)
            </a>
          </>
        ) : null}
      </div>

      <div style={card}>
        <h2 style={sectionTitle}>What&apos;s included</h2>
        <p style={sectionNote}>Two sheets in the downloaded file:</p>
        <ul style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, paddingLeft: '18px' }}>
          <li style={{ marginBottom: '6px' }}>
            <b>Audits</b> — one row per submitted audit: agent, team, site, vintage, auditor, call date &amp; duration, CRM lead link, call status,
            score, pass/fail, critical fatal (with a summary of any fatal items), overall feedback, and submission date.
          </li>
          <li>
            <b>Failed Parameters</b> — one row per rubric parameter that failed on an audit above, with the points lost and the specific feedback.
            Passed parameters aren&apos;t listed — they carry no feedback.
          </li>
        </ul>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '10px 0 0' }}>
          Drafts and Sample Checks are never included. If an audit was later revised through a Review Request, only the current/revised result shows.
        </p>
      </div>
    </div>
  )
}
