import { BackLink } from '@/components/common/BackLink'
import { TargetRuleForm } from '@/components/admin/targets/TargetRuleForm'
import { isMissingTargetsSchema, loadTargetRules, type TargetRuleRow, type TargetRules } from '@/lib/queue/queue.service'
import { salesWeekStartDate } from '@/lib/dates/sales-week'
import { formatUsd } from '@/lib/money/usd'
import { TEAM_NAMES } from '@/types/database.types'

const card: React.CSSProperties = {
  padding: '16px 20px', borderRadius: 'var(--radius-lg)', background: 'var(--surface)',
  borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', marginBottom: '20px',
}
const th: React.CSSProperties = { textAlign: 'left', fontSize: '12px', color: 'var(--text-muted)', padding: '6px 8px', fontWeight: 500 }
const td: React.CSSProperties = { padding: '8px', fontSize: '14px', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'var(--border)' }

const ymd = (d: string) => d.slice(0, 10)

function RulesTable({ rows, kind, thisWeek }: { rows: TargetRuleRow[]; kind: 'audit' | 'revenue'; thisWeek: string }) {
  if (rows.length === 0) return <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No targets set yet.</div>
  // Per key, the newest rule already in force is "current"; later ones are "scheduled"; older ones are "history".
  const keyOf = (r: TargetRuleRow) => `${r.isOjt ? 'ojt' : r.vintageLabel}|${r.teamName ?? ''}`
  const current = new Set<string>()
  const seen = new Set<string>()
  for (const r of rows) { // rows arrive newest first
    const k = keyOf(r)
    if (!seen.has(k) && ymd(r.effectiveFrom) <= thisWeek) { current.add(r.id); seen.add(k) }
  }
  const state = (r: TargetRuleRow) => (ymd(r.effectiveFrom) > thisWeek ? 'Scheduled' : current.has(r.id) ? 'Current' : 'History')
  const fmt = (v: number) => (kind === 'audit' ? `${v} / week` : `${formatUsd(v)} / week`)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '480px' }}>
        <thead><tr><th style={th}>Vintage</th><th style={th}>Team</th><th style={th}>Target</th><th style={th}>From week</th><th style={th} /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ opacity: state(r) === 'History' ? 0.55 : 1 }}>
              <td style={td}>{r.isOjt ? 'OJT' : r.vintageLabel}</td>
              <td style={td}>{r.teamName ?? 'All teams'}</td>
              <td style={td}><b>{fmt(r.value)}</b></td>
              <td style={td}>{ymd(r.effectiveFrom)}</td>
              <td style={td}>{state(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function TargetsAdminPage() {
  let rules: TargetRules | null = null
  let failure: unknown = null
  try {
    rules = await loadTargetRules()
  } catch (err) {
    failure = err
    if (!isMissingTargetsSchema(err)) console.error(err)
  }
  const thisWeek = salesWeekStartDate(new Date())

  return (
    <div style={{ maxWidth: '960px' }}>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Audit &amp; revenue targets</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Weekly targets by vintage and team. A change never rewrites a past week: it starts this sales week or next, and earlier weeks keep what they had.
        Agents with no matching target show &quot;target not set&quot; on the QA queue.
      </p>

      {failure || !rules ? (
        isMissingTargetsSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--highlight)', fontSize: '14px' }}>
            <b>The target database changes haven&apos;t been applied yet.</b> Run <code>supabase/schema_034_audit_targets.sql</code> in the Supabase SQL Editor, then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Targets could not be loaded right now. This does not mean none are set — try again shortly.</div>
        )
      ) : (
        <>
          <section style={card} aria-label="Audit targets">
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 2px' }}>Weekly audit target (per agent)</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 14px' }}>
              OJT starts at 3 a week. +1 more is added automatically for an agent who is Red, on a PIP or a zero-seller (never stacked).
            </p>
            <TargetRuleForm kind="audit" slabLabels={rules.slabLabels} teams={TEAM_NAMES} />
            <div style={{ marginTop: '16px' }}><RulesTable rows={rules.audit} kind="audit" thisWeek={thisWeek} /></div>
          </section>

          <section style={card} aria-label="Revenue targets">
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 2px' }}>Weekly revenue target (per agent, US dollars)</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 14px' }}>
              Used for the last tier of the QA queue&apos;s priority order (revenue achievement %, lowest first). Each week is measured against the target in force that week.
            </p>
            <TargetRuleForm kind="revenue" slabLabels={rules.slabLabels} teams={TEAM_NAMES} />
            <div style={{ marginTop: '16px' }}><RulesTable rows={rules.revenue} kind="revenue" thisWeek={thisWeek} /></div>
          </section>
        </>
      )}
    </div>
  )
}
