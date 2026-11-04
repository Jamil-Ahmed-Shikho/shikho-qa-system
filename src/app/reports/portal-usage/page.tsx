import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import {
  isMissingPortalUsageSchema,
  loadPortalUsage,
  type PortalUsageRow,
} from '@/lib/portal-usage/portal-usage.service'
import { PortalUsageView } from '@/components/portal-usage/PortalUsageView'

const pill = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: active ? 600 : 400,
  background: active ? 'var(--brand)' : 'var(--surface-1)', color: active ? 'white' : 'var(--text-secondary)',
})

export default async function PortalUsagePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  const view: QaRankingView = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'

  let backOffice: PortalUsageRow[] = []
  let frontline: PortalUsageRow[] = []
  let failure: unknown = null
  try {
    ;[backOffice, frontline] = await Promise.all([
      loadPortalUsage('back_office', 'team'), // Back Office has no My/Team toggle (confirmed design) — always the caller's own scope
      loadPortalUsage('frontline', view),
    ])
  } catch (err) {
    failure = err
    if (!isMissingPortalUsageSchema(err)) console.error(err)
  }

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Portal Usage</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Who&apos;s actually signing in and using this portal — not page-by-page tracking, just whether someone was active on a given day.
        Active = used in the last 3 days. Low usage = 3–13 days since last use. Inactive = 14+ days, or never used.
      </p>

      {isAuditor && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          <Link href="/reports/portal-usage?view=mine" aria-current={view === 'mine' ? 'page' : undefined} style={pill(view === 'mine')}>My view</Link>
          <Link href="/reports/portal-usage?view=team" aria-current={view === 'team' ? 'page' : undefined} style={pill(view === 'team')}>Team view</Link>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>(Frontline usage only — Back Office always shows your own row.)</span>
        </div>
      )}

      {failure ? (
        isMissingPortalUsageSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_109_portal_usage_tracking.sql</code> (and
            <code> supabase/schema_110_portal_usage_backfill_sessions.sql</code>, which backfills real login history from before this report existed), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : (
        <PortalUsageView backOffice={backOffice} frontline={frontline} />
      )}
    </div>
  )
}
