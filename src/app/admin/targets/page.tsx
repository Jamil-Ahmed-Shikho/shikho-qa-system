import { BackLink } from '@/components/common/BackLink'
import { TargetRuleForm } from '@/components/admin/targets/TargetRuleForm'
import { isMissingTargetsSchema, loadTargetRules, type TargetRules } from '@/lib/queue/queue.service'
import { salesWeekStartDate } from '@/lib/dates/sales-week'
import { TEAM_NAMES } from '@/types/database.types'

const card: React.CSSProperties = {
  padding: '16px 20px', borderRadius: 'var(--radius-lg)', background: 'var(--surface)',
  borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', marginBottom: '20px',
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
            <TargetRuleForm kind="audit" slabLabels={rules.slabLabels} teams={TEAM_NAMES} rows={rules.audit} thisWeek={thisWeek} />
          </section>

          <section style={card} aria-label="Revenue targets">
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 2px' }}>Weekly revenue target (per agent, US dollars)</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 14px' }}>
              Used for the last tier of the QA queue&apos;s priority order (revenue achievement %, lowest first). Each week is measured against the target in force that week.
            </p>
            <TargetRuleForm kind="revenue" slabLabels={rules.slabLabels} teams={TEAM_NAMES} rows={rules.revenue} thisWeek={thisWeek} />
          </section>

          <a href="/admin/holidays" style={{ display: 'block', padding: '14px 18px', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', border: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '2px' }}>Holiday calendar →</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Mark holidays with a note, per site or both — the current week&apos;s targets shrink automatically to match (§9.4).</div>
          </a>
        </>
      )}
    </div>
  )
}
