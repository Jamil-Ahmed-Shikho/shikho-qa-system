import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { PERIOD_OPTIONS, describeRange, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import {
  isMissingRepeatMistakeSchema,
  loadRepeatMistakeReport,
  STATUS_LABEL,
  type RepeatMistakeRow,
  type RepeatMistakeStatus,
} from '@/lib/repeat-mistakes/repeat-mistakes.service'
import { RepeatMistakeGroups, type RepeatMistakeGroup, type RepeatMistakeGroupRow } from '@/components/repeat-mistakes/RepeatMistakeGroups'

const selectStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: '13px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--paper)',
}
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }
const checklist: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '160px', overflowY: 'auto', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', fontSize: '13px', fontWeight: 400, textTransform: 'none', letterSpacing: 'normal' }
const tile: React.CSSProperties = { background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', minWidth: '130px', textAlign: 'center' }

const STATUS_OPTIONS: RepeatMistakeStatus[] = ['still_failing', 'not_yet_rechecked', 'improved']

function toArray(v: string | string[] | undefined): string[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

export default async function RepeatMistakeReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    parameter?: string | string[]
    status?: string | string[]
    team?: string
    site?: string
    teamLeader?: string
    period?: string
    view?: string
  }>
}) {
  const sp = await searchParams
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  const isManager = user?.role === 'manager'
  const view = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'
  const agentHref = (agentId: string) => (isManager ? `/dashboard/manager/agent/${agentId}` : `/audits/agent/${agentId}/profile`)

  let rows: RepeatMistakeRow[] = []
  let failure: unknown = null
  try {
    rows = await loadRepeatMistakeReport(view)
  } catch (err) {
    failure = err
    if (!isMissingRepeatMistakeSchema(err)) console.error(err)
  }

  // Filter option lists come from the FULL scoped set, before filtering — so choosing one filter
  // never makes the others' options shrink out from under you.
  const parameters = [...new Map(rows.map((r) => [r.parameterId, r.parameterName])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const teams = [...new Set(rows.map((r) => r.teamName).filter((t): t is string => !!t))].sort()
  const sites = [...new Set(rows.map((r) => r.siteName).filter((s): s is string => !!s))].sort()
  const teamLeaders = [...new Set(rows.map((r) => r.teamLeaderName).filter((t): t is string => !!t))].sort()

  const selectedParams = toArray(sp.parameter).filter((id) => parameters.some(([pid]) => pid === id))
  const selectedStatuses = toArray(sp.status).filter((s): s is RepeatMistakeStatus => STATUS_OPTIONS.includes(s as RepeatMistakeStatus))
  const selectedTeam = sp.team && teams.includes(sp.team) ? sp.team : ''
  const selectedSite = sp.site && sites.includes(sp.site) ? sp.site : ''
  const selectedTeamLeader = sp.teamLeader && teamLeaders.includes(sp.teamLeader) ? sp.teamLeader : ''

  const visible = rows.filter((r) =>
    (selectedParams.length === 0 || selectedParams.includes(r.parameterId)) &&
    (selectedStatuses.length === 0 || selectedStatuses.includes(r.status)) &&
    (!selectedTeam || r.teamName === selectedTeam) &&
    (!selectedSite || r.siteName === selectedSite) &&
    (!selectedTeamLeader || r.teamLeaderName === selectedTeamLeader)
  )

  // The period picker drives ONLY this comparison tile — it never hides a currently-active pattern
  // from the table just because it started before the selected window.
  const period = parsePeriod(sp.period)
  const range = periodRange(period)
  const periodLengthMs = range.to.getTime() - range.from.getTime()
  const priorRange = { from: new Date(range.from.getTime() - periodLengthMs), to: range.from }
  const inRange = (iso: string, r: { from: Date; to: Date }) => { const t = new Date(iso).getTime(); return t >= r.from.getTime() && t < r.to.getTime() }
  const newThisPeriod = visible.filter((r) => inRange(r.firstFlaggedAt, range)).length
  const newPriorPeriod = visible.filter((r) => inRange(r.firstFlaggedAt, priorRange)).length

  const statusCounts = { still_failing: 0, improved: 0, not_yet_rechecked: 0 }
  for (const r of visible) statusCounts[r.status]++

  // Functions can't cross the server/client boundary as props, so each row's profile link is
  // built once here, server-side, rather than passed down as a callback.
  const visibleWithHref: RepeatMistakeGroupRow[] = visible.map((r) => ({ ...r, agentHref: agentHref(r.agentId) }))

  // Group by parameter — ranked by how many agents it's affecting (the widest training gap first).
  const byParamMap = new Map<string, RepeatMistakeGroupRow[]>()
  for (const r of visibleWithHref) byParamMap.set(r.parameterId, [...(byParamMap.get(r.parameterId) ?? []), r])
  const byParameter: RepeatMistakeGroup[] = [...byParamMap.entries()]
    .map(([parameterId, groupRows]) => ({
      key: parameterId, label: groupRows[0].parameterName, labelHref: null, subLabel: null,
      rows: [...groupRows].sort((a, b) => b.failCount - a.failCount || a.agentName.localeCompare(b.agentName)),
    }))
    .sort((a, b) => b.rows.length - a.rows.length || b.rows[0].failCount - a.rows[0].failCount)

  // Group by agent — ranked by how many different parameters they're flagged on, then worst count.
  const byAgentMap = new Map<string, RepeatMistakeGroupRow[]>()
  for (const r of visibleWithHref) byAgentMap.set(r.agentId, [...(byAgentMap.get(r.agentId) ?? []), r])
  const byAgent: RepeatMistakeGroup[] = [...byAgentMap.entries()]
    .map(([agentId, groupRows]) => ({
      key: agentId, label: groupRows[0].agentName, labelHref: groupRows[0].agentHref,
      subLabel: [groupRows[0].teamName, groupRows[0].siteName].filter(Boolean).join(' · ') || null,
      rows: [...groupRows].sort((a, b) => b.failCount - a.failCount),
    }))
    .sort((a, b) => b.rows.length - a.rows.length || Math.max(...b.rows.map((r) => r.failCount)) - Math.max(...a.rows.map((r) => r.failCount)))

  const qs = (overrides: { period?: string; view?: string }) => {
    const p = new URLSearchParams()
    for (const pid of selectedParams) p.append('parameter', pid)
    for (const s of selectedStatuses) p.append('status', s)
    if (selectedTeam) p.set('team', selectedTeam)
    if (selectedSite) p.set('site', selectedSite)
    if (selectedTeamLeader) p.set('teamLeader', selectedTeamLeader)
    p.set('period', overrides.period ?? period)
    p.set('view', overrides.view ?? view)
    return `?${p.toString()}`
  }
  const clearHref = `?period=${period}&view=${view}`

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Repeat-Mistake Report</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '700px' }}>
        Agents whose audits show the SAME rubric parameter failing repeatedly — flagged automatically the moment it
        fails in 3 of their last 5 audits on that parameter. Purely a count of what already happened, for spotting
        training-needs patterns — it never changes a score. Looking for whether a parameter is trending better or
        worse over time? That&apos;s the <Link href="/reports/qa-rubric-trends" style={{ color: 'var(--brand)', fontWeight: 600 }}>Rubric Fail Trends</Link> report — this one is about WHO currently has a pattern.
      </p>

      {failure ? (
        isMissingRepeatMistakeSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_087_repeat_mistake_report_filters.sql</code> (after 086), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>The report could not be loaded right now. This does not mean there is nothing to show — try again shortly.</div>
        )
      ) : rows.length === 0 ? (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
          Nobody currently shows a repeat-mistake pattern — nothing has failed the same parameter 3 of the last 5 times.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '14px', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }} role="tablist" aria-label="Period (for the new-patterns comparison only)">
              {PERIOD_OPTIONS.map((p) => (
                <Link key={p.value} href={qs({ period: p.value })} role="tab" aria-selected={period === p.value}
                  style={{ padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', fontWeight: period === p.value ? 600 : 400, background: period === p.value ? 'var(--brand)' : 'var(--surface-1)', color: period === p.value ? 'white' : 'var(--text-secondary)' }}>
                  {p.label}
                </Link>
              ))}
            </div>
            {isAuditor && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <Link href={qs({ view: 'mine' })} aria-current={view === 'mine' ? 'page' : undefined}
                  style={{ padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', border: `1px solid ${view === 'mine' ? 'var(--brand)' : 'var(--border)'}`, background: view === 'mine' ? 'var(--brand)' : 'transparent', color: view === 'mine' ? '#fff' : 'inherit' }}>
                  My view
                </Link>
                <Link href={qs({ view: 'team' })} aria-current={view === 'team' ? 'page' : undefined}
                  style={{ padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)', border: `1px solid ${view === 'team' ? 'var(--brand)' : 'var(--border)'}`, background: view === 'team' ? 'var(--brand)' : 'transparent', color: view === 'team' ? '#fff' : 'inherit' }}>
                  Team view
                </Link>
              </div>
            )}
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '-6px 0 16px' }}>{describeRange(range)} — only affects the &quot;new patterns&quot; tile below, not which rows are shown.</p>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700 }}>{visible.length}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Active patterns</div></div>
            <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--alert)' }}>{statusCounts.still_failing}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Still failing</div></div>
            <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-muted)' }}>{statusCounts.not_yet_rechecked}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Not yet re-checked</div></div>
            <div style={tile}><div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--status-green)' }}>{statusCounts.improved}</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Improved</div></div>
            <div style={tile}>
              <div style={{ fontSize: '22px', fontWeight: 700 }}>{newThisPeriod}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>New patterns this period</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>({newPriorPeriod} the period before)</div>
            </div>
          </div>

          <form method="get" style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '20px', background: 'var(--surface-0)', padding: '14px', borderRadius: 'var(--radius-md)' }}>
            <input type="hidden" name="period" value={period} />
            <input type="hidden" name="view" value={view} />
            <label style={label}>
              Parameter(s)
              <div style={checklist}>
                {parameters.map(([id, name]) => (
                  <label key={id} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input type="checkbox" name="parameter" value={id} defaultChecked={selectedParams.includes(id)} />
                    {name}
                  </label>
                ))}
              </div>
            </label>
            <label style={label}>
              Status
              <div style={{ ...checklist, maxHeight: 'none' }}>
                {STATUS_OPTIONS.map((s) => (
                  <label key={s} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input type="checkbox" name="status" value={s} defaultChecked={selectedStatuses.includes(s)} />
                    {STATUS_LABEL[s]}
                  </label>
                ))}
              </div>
            </label>
            <label style={label}>
              Channel
              <select name="team" defaultValue={selectedTeam} style={selectStyle}>
                <option value="">All channels</option>
                {teams.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label style={label}>
              Site
              <select name="site" defaultValue={selectedSite} style={selectStyle}>
                <option value="">All sites</option>
                {sites.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {teamLeaders.length > 0 && (
              <label style={label}>
                Team Leader
                <select name="teamLeader" defaultValue={selectedTeamLeader} style={selectStyle}>
                  <option value="">All Team Leaders</option>
                  {teamLeaders.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            )}
            <div style={{ display: 'flex', gap: '8px', alignSelf: 'flex-end' }}>
              <button type="submit" style={{ padding: '9px 18px', fontSize: '13px', fontWeight: 600, color: 'white', background: 'var(--brand)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
                Apply filters
              </button>
              <Link href={clearHref} style={{ padding: '9px 18px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', textDecoration: 'none' }}>
                Clear
              </Link>
            </div>
          </form>

          {visible.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No patterns match these filters.</p>
          ) : (
            <RepeatMistakeGroups byParameter={byParameter} byAgent={byAgent} />
          )}
        </>
      )}
    </div>
  )
}
