import { notFound } from 'next/navigation'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PERIOD_OPTIONS, parsePeriod } from '@/lib/dates/sales-week'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import { TEAM_NAMES, type TeamName } from '@/types/database.types'
import { isMissingQaRubricTrendsSchema, loadParameterCoachingList } from '@/lib/qa-rubric-trends/qa-rubric-trends.service'

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '8px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)' }

function parseChannel(raw: string | undefined): TeamName | null {
  if (raw === 'all') return null
  if (raw && (TEAM_NAMES as readonly string[]).includes(raw)) return raw as TeamName
  return 'Telesales'
}

export default async function ParameterCoachingPage({
  params, searchParams,
}: {
  params: Promise<{ parameterId: string }>
  searchParams: Promise<{ period?: string; view?: string; channel?: string }>
}) {
  const { parameterId } = await params
  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const channel = parseChannel(sp.channel)
  const user = await getAuthUser()
  const isAuditor = user?.role === 'qa_auditor'
  const isTeamLeadOrManager = user?.role === 'team_lead' || user?.role === 'manager'
  const view: QaRankingView = sp.view === 'mine' || sp.view === 'team' ? sp.view : isAuditor ? 'mine' : 'team'
  const effectiveChannel = isTeamLeadOrManager ? null : channel
  const backHref = `/reports/qa-rubric-trends?period=${period}&view=${view}&channel=${encodeURIComponent(channel ?? 'all')}`

  const supabase = await getSupabaseServer()
  const { data: parameter } = await supabase
    .from('rubric_parameters')
    .select('id, name, rubric_categories(name, rubrics(name))')
    .eq('id', parameterId)
    .maybeSingle()
  if (!parameter) notFound()
  type OneOrMany<T> = T | T[] | null
  const one = <T,>(v: OneOrMany<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v)
  const category = one(parameter.rubric_categories as OneOrMany<{ name: string; rubrics: OneOrMany<{ name: string }> }>)
  const rubric = category ? one(category.rubrics) : null

  let rows: { agentId: string; agentName: string; teamLeaderName: string | null; totalCount: number; failCount: number }[] = []
  let failure: unknown = null
  try {
    const all = await loadParameterCoachingList(view, effectiveChannel)
    rows = all.filter((r) => r.parameterId === parameterId)
  } catch (err) {
    failure = err
    if (!isMissingQaRubricTrendsSchema(err)) console.error(err)
  }

  return (
    <div>
      <BackLink href={backHref} label="Rubric Fail Trends" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>{parameter.name}</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
        {category?.name}{rubric ? ` · ${rubric.name}` : ''} — who failed this parameter this sales week, worst first.
      </p>

      {failure ? (
        isMissingQaRubricTrendsSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', border: '1px solid var(--highlight)', fontSize: '14px' }}>
            <b>This database change hasn&apos;t been applied yet.</b> Run <code>supabase/schema_100_qa_parameter_coaching_list_counts.sql</code> (after 099), then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Could not be loaded right now. Try again shortly.</div>
        )
      ) : rows.length === 0 ? (
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nobody failed this parameter this sales week.</p>
      ) : (
        <div style={card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Agent</th>
                  <th style={th}>Team Lead</th>
                  <th style={th}>Audits (this week)</th>
                  <th style={th}>Failed</th>
                  <th style={th}>Fail rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.agentId}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.agentName}</td>
                    <td style={td}>{r.teamLeaderName ?? '—'}</td>
                    <td style={td}>{r.totalCount}</td>
                    <td style={td}>{r.failCount}</td>
                    <td style={td}>{Math.round((r.failCount / r.totalCount) * 1000) / 10}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '14px 0 0' }}>
        Period shown on Rubric Fail Trends: {PERIOD_OPTIONS.find((p) => p.value === period)?.label ?? period} (this list itself always covers the current sales week).
      </p>
    </div>
  )
}
