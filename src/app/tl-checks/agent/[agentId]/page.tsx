import { redirect } from 'next/navigation'
import { BackLink } from '@/components/common/BackLink'
import { TlCheckCallBrowserList } from '@/components/team-lead-checks/TlCheckCallBrowserList'
import { getAuthUser } from '@/lib/auth/auth.service'
import { CrmApiError } from '@/lib/crm/client'
import { CALL_STATUS_OPTIONS, DATE_RANGE_OPTIONS } from '@/lib/crm/agent-calls'
import { isCrmUnreachable, loadBrowsableAgent, loadTlCheckCallPage, parseFilters } from '@/lib/team-lead-checks/call-browser.service'

const field: React.CSSProperties = {
  padding: '8px 10px', fontSize: '13px', borderRadius: 'var(--radius-md)', borderWidth: '1px', borderStyle: 'solid',
  borderColor: 'var(--border)', background: 'var(--surface)', color: 'inherit', width: '100%',
}
const label: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 500, margin: '0 0 4px', color: 'var(--text-muted)' }

type SearchParams = Record<string, string | string[] | undefined>

export default async function TlCheckAgentCallBrowserPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>
  searchParams: Promise<SearchParams>
}) {
  const viewer = await getAuthUser()
  if (!viewer) redirect('/auth/login')
  if (viewer.role !== 'team_lead') redirect('/dashboard')

  const { agentId } = await params
  const sp = await searchParams
  const filters = parseFilters(sp)
  const beforeId = sp.before ? Number(sp.before) : null

  const agent = await loadBrowsableAgent(agentId)
  if (!agent) {
    return (
      <div>
        <BackLink href="/tl-checks" label="Team Leader Checks" />
        <ErrorState message="No such agent." />
      </div>
    )
  }

  const qs = (overrides: Record<string, string | null>) => {
    const q = new URLSearchParams()
    const merged = { status: filters.status ?? '', duration: String(filters.minDurationSeconds ?? ''), stage: filters.leadStageId ?? '', dist: filters.distributionList ?? '', range: filters.range, from: filters.customFrom ?? '', to: filters.customTo ?? '', ...overrides }
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v)
    return `?${q.toString()}`
  }

  return (
    <div>
      <BackLink href="/tl-checks" label="Team Leader Checks" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>{agent.name}&apos;s calls</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
        {[agent.teamName, agent.siteName].filter(Boolean).join(' · ') || agent.email}
      </p>

      {agent.crmAgentId === null ? (
        <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--highlight)', fontSize: '14px' }}>
          This agent hasn&apos;t been matched to a CRM id yet, so their calls can&apos;t be browsed here. Once QA has
          audited one of their calls, this page will work for them.
        </div>
      ) : (
        <AgentCalls agent={agent} filters={filters} beforeId={beforeId} viewerId={viewer.profile.id} qs={qs} />
      )}
    </div>
  )
}

async function AgentCalls({
  agent,
  filters,
  beforeId,
  viewerId,
  qs,
}: {
  agent: Awaited<ReturnType<typeof loadBrowsableAgent>> & object
  filters: ReturnType<typeof parseFilters>
  beforeId: number | null
  viewerId: string
  qs: (o: Record<string, string | null>) => string
}) {
  let page
  try {
    page = await loadTlCheckCallPage(agent, filters, beforeId, viewerId)
  } catch (err) {
    const message = err instanceof CrmApiError ? err.message : 'Could not reach the CRM.'
    return <ErrorState message={isCrmUnreachable(err) ? 'Could not reach the CRM — please try again.' : message} />
  }

  return (
    <div>
      <form method="get" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', alignItems: 'end', padding: '14px 16px', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', marginBottom: '16px' }}>
        <div>
          <label style={label} htmlFor="status">Call status</label>
          <select id="status" name="status" defaultValue={filters.status ?? ''} style={field}>
            <option value="">Any</option>
            {CALL_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="duration">Duration over (seconds)</label>
          <input id="duration" name="duration" type="number" min={0} step={15} defaultValue={filters.minDurationSeconds ?? 0} style={field} />
        </div>
        <div>
          <label style={label} htmlFor="stage">Lead stage</label>
          <select id="stage" name="stage" defaultValue={filters.leadStageId ?? ''} style={field}>
            <option value="">Any</option>
            {page.leadStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="dist">Distribution list</label>
          <input id="dist" name="dist" defaultValue={filters.distributionList ?? ''} placeholder="Type a list name" style={field} />
        </div>
        <div>
          <label style={label} htmlFor="range">Date range</label>
          <select id="range" name="range" defaultValue={filters.range} style={field}>
            {DATE_RANGE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="from">From (if Specific)</label>
          <input id="from" name="from" type="date" defaultValue={filters.customFrom ?? ''} style={field} />
        </div>
        <div>
          <label style={label} htmlFor="to">To (if Specific)</label>
          <input id="to" name="to" type="date" defaultValue={filters.customTo ?? ''} style={field} />
        </div>
        <div>
          <button type="submit" style={{ padding: '9px 18px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--brand)', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer', width: '100%' }}>
            Filter
          </button>
        </div>
      </form>

      <TlCheckCallBrowserList rows={page.rows} agentId={agent.id} />

      {page.nextCursor && (
        <div style={{ marginTop: '14px' }}>
          <a href={qs({ before: String(page.nextCursor) })} style={{ fontSize: '13px', color: 'var(--brand)', textDecoration: 'none' }}>
            Load more →
          </a>
        </div>
      )}
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--alert-light)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--alert)', fontSize: '14px', color: 'var(--alert)' }}>
      {message}
    </div>
  )
}
