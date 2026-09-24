import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { listCampaigns } from '@/lib/campaigns/campaigns.service'
import { activeChecks, campaignReadiness, scopeLabel } from '@/lib/campaigns/rules'

type View = 'active' | 'archived' | 'all'

export default async function CampaignsListPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams
  const view: View = show === 'archived' || show === 'all' ? show : 'active'
  const all = await listCampaigns()
  const shown = all.filter(({ tree }) => view === 'all' || (view === 'archived' ? tree.is_archived : !tree.is_archived))
  const counts = { active: all.filter((c) => !c.tree.is_archived).length, archived: all.filter((c) => c.tree.is_archived).length, all: all.length }

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Special Checks</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0, maxWidth: '640px' }}>
            Temporary, ad-hoc checks for management (e.g. &ldquo;is the agent mentioning the new course launch?&rdquo;). They are recorded on an audit
            but never change its score.
          </p>
        </div>
        <Link href="/admin/campaigns/new" style={{ padding: '10px 18px', fontSize: '14px', fontWeight: 500, color: 'white', background: 'var(--brand)', borderRadius: 'var(--radius-sm)', textDecoration: 'none' }}>
          + New Campaign
        </Link>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }} role="tablist" aria-label="Campaign view">
        {(['active', 'archived', 'all'] as const).map((v) => (
          <Link
            key={v}
            href={v === 'active' ? '/admin/campaigns' : `/admin/campaigns?show=${v}`}
            role="tab" aria-selected={view === v}
            style={{
              padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: view === v ? 600 : 400,
              background: view === v ? 'var(--brand)' : 'var(--surface-1)', color: view === v ? 'white' : 'var(--text-secondary)',
            }}
          >
            {v === 'active' ? 'Active' : v === 'archived' ? 'Archived' : 'All'} ({counts[v]})
          </Link>
        ))}
      </div>

      {shown.length === 0 && (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
          {all.length === 0 ? 'No campaigns yet. Create the first one to get started.' : `No ${view} campaigns.`}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {shown.map(({ tree, usage }) => {
          const readiness = campaignReadiness(tree)
          const checks = activeChecks(tree).length
          return (
            <Link
              key={tree.id}
              href={`/admin/campaigns/${tree.id}`}
              style={{
                display: 'block', padding: '16px 18px', textDecoration: 'none', color: 'var(--text-primary)', background: 'var(--paper)',
                borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)', borderRadius: 'var(--radius-md)', opacity: tree.is_archived ? 0.75 : 1,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 600, overflowWrap: 'anywhere' }}>{tree.name}</div>
                  {tree.description && <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px', overflowWrap: 'anywhere' }}>{tree.description}</div>}
                </div>
                {tree.is_archived
                  ? <Pill bg="var(--surface-1)" color="var(--text-muted)">Archived</Pill>
                  : readiness.ready
                    ? <Pill bg="#E5F5EC" color="var(--status-green)">Active</Pill>
                    : <Pill bg="var(--highlight-light)" color="var(--text-primary)" title={readiness.problems.join(' ')}>Setup incomplete</Pill>}
              </div>
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>
                <span><b style={{ color: 'var(--text-secondary)' }}>{scopeLabel(tree)}</b></span>
                <span>{checks} check{checks === 1 ? '' : 's'}</span>
                <span>{usage.submitted} submitted audit{usage.submitted === 1 ? '' : 's'}</span>
                {usage.draft > 0 && <span>{usage.draft} in progress</span>}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function Pill({ bg, color, title, children }: { bg: string; color: string; title?: string; children: React.ReactNode }) {
  return <span title={title} style={{ fontSize: '12px', fontWeight: 600, padding: '3px 10px', borderRadius: 'var(--radius-pill)', background: bg, color, whiteSpace: 'nowrap' }}>{children}</span>
}
