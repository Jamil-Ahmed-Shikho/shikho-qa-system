import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { PERIOD_OPTIONS, describeRange, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import { TEAM_NAMES, type TeamName } from '@/types/database.types'
import {
  isMissingContactStageSchema, loadContactStageDistribution, type ContactStageRow,
} from '@/lib/contact-stage/contact-stage.service'
import { ContactStageChart, ContactStageTable } from '@/components/contact-stage/ContactStageView'

const pill = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: active ? 600 : 400,
  background: active ? 'var(--brand)' : 'var(--surface-1)', color: active ? 'white' : 'var(--text-secondary)',
})
const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '24px' }

function parseChannel(raw: string | undefined): TeamName | null {
  if (!raw || raw === 'all') return null
  return (TEAM_NAMES as readonly string[]).includes(raw) ? (raw as TeamName) : null
}

export default async function ContactStagePage({ searchParams }: { searchParams: Promise<{ period?: string; view?: string; channel?: string }> }) {
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const range = periodRange(period)
  const channel = parseChannel(sp.channel)
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  const view: QaRankingView = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'

  let rows: ContactStageRow[] = []
  let failure: unknown = null
  try {
    rows = await loadContactStageDistribution(range.from, range.to, view, channel)
  } catch (err) {
    failure = err
    if (!isMissingContactStageSchema(err)) console.error(err)
  }

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Contact Stage Audit Coverage</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        What lead stage was each audited call at — at the time of that call, not today. Counts real submitted audits
        only (Sample Checks excluded), grouped by the lead&apos;s stage at call time.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} role="tablist" aria-label="Period">
          {PERIOD_OPTIONS.map((p) => (
            <Link key={p.value} href={`/reports/contact-stage?period=${p.value}&view=${view}&channel=${encodeURIComponent(channel ?? 'all')}`} role="tab" aria-selected={period === p.value} style={pill(period === p.value)}>
              {p.label}
            </Link>
          ))}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{describeRange(range)}</span>
        </div>
        {isAuditor && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <Link href={`/reports/contact-stage?period=${period}&view=mine&channel=${encodeURIComponent(channel ?? 'all')}`} aria-current={view === 'mine' ? 'page' : undefined} style={pill(view === 'mine')}>My view</Link>
            <Link href={`/reports/contact-stage?period=${period}&view=team&channel=${encodeURIComponent(channel ?? 'all')}`} aria-current={view === 'team' ? 'page' : undefined} style={pill(view === 'team')}>Team view</Link>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }} role="tablist" aria-label="Channel">
        <Link href={`/reports/contact-stage?period=${period}&view=${view}&channel=all`} aria-current={channel === null ? 'page' : undefined} style={pill(channel === null)}>All channels</Link>
        {TEAM_NAMES.map((t) => (
          <Link key={t} href={`/reports/contact-stage?period=${period}&view=${view}&channel=${encodeURIComponent(t)}`} aria-current={channel === t ? 'page' : undefined} style={pill(channel === t)}>
            {t}
          </Link>
        ))}
      </div>

      {failure ? (
        isMissingContactStageSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_116_contact_stage_distribution.sql</code>, then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : (
        <>
          <div style={card}>
            <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 12px' }}>Company-wide shape</h2>
            <ContactStageChart rows={rows} />
          </div>
          <div style={card}>
            <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }}>By auditor</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }}>
              Number of calls audited per contact stage, and each as a % of that auditor&apos;s own audited calls.
            </p>
            <ContactStageTable rows={rows} />
          </div>
        </>
      )}
    </div>
  )
}
