import Link from 'next/link'
import { isMissingTargetsSchema, loadQueue, type QueueView } from '@/lib/queue/queue.service'
import { rankQueue, summarizeTargets, type QueueRow } from '@/lib/queue/priority'
import { loadOjtCandidates, isMissingOjtSchema, type OjtCandidate } from '@/lib/ojt/ojt.service'
import { AgentQueueTable } from './AgentQueueTable'

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '18px 20px', marginTop: '24px',
}
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '6px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

function ViewToggle({ view, base }: { view: QueueView; base: string }) {
  const tab = (v: QueueView, text: string) => (
    <Link
      href={`${base}?view=${v}`}
      aria-current={view === v ? 'page' : undefined}
      style={{
        padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)',
        borderWidth: '1px', borderStyle: 'solid', borderColor: view === v ? 'var(--brand)' : 'var(--border)',
        background: view === v ? 'var(--brand)' : 'transparent', color: view === v ? '#fff' : 'inherit',
      }}
    >
      {text}
    </Link>
  )
  return <div style={{ display: 'flex', gap: '8px' }}>{tab('mine', 'My view')}{tab('team', 'Team view')}</div>
}

/**
 * The QA dashboard's target summary + priority-sorted agent queue (§9). The database limits the rows: My view = the
 * auditor's assigned agents, Team view = everyone (a QA Auditor is QA staff, so both are allowed — §2's standing rule).
 */
export async function QueueSection({ view, base }: { view: QueueView; base: string }) {
  let rows: QueueRow[] = []
  try {
    rows = await loadQueue(view)
  } catch (err) {
    if (isMissingTargetsSchema(err)) {
      return (
        <section style={card} aria-label="Audit queue">
          <p role="alert" style={{ fontSize: '14px', margin: 0 }}>
            <b>The target database changes haven&apos;t been applied yet.</b> Run <code>supabase/schema_034_audit_targets.sql</code> in the Supabase SQL Editor, then reload.
          </p>
        </section>
      )
    }
    console.error(err)
    return (
      <section style={card} aria-label="Audit queue">
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Audit queue</h2>
        <p role="alert" style={{ color: 'var(--alert)', fontSize: '13px', margin: '8px 0 0' }}>The queue could not be loaded — this does not mean it is empty.</p>
      </section>
    )
  }

  const ranked = rankQueue(rows)
  const { total, groups } = summarizeTargets(rows)

  // Re-training agents, appended below the ranked list (2026-10-03, Jamil's request) — never
  // folded into the ranking or the target summary above (their target isn't a weekly number).
  // A load failure here is quietly swallowed (shows nothing extra) rather than breaking the
  // whole queue — this is a supplementary flag, not the main screen.
  let reTraining: OjtCandidate[] = []
  try {
    const candidates = await loadOjtCandidates(view)
    reTraining = candidates.filter((c) => c.stage === 're_training')
  } catch (err) {
    if (!isMissingOjtSchema(err)) console.error('loadOjtCandidates failed:', err)
  }

  return (
    <>
      <section style={card} aria-label="Weekly audit target">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>This week&apos;s audit target</h2>
          <ViewToggle view={view} base={base} />
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 12px' }}>
          Sales week (Saturday–Friday). {view === 'mine' ? 'Agents assigned to you.' : 'Every agent.'} A target is the sum of each agent&apos;s weekly target, including the +1 bonus.
        </p>
        {rows.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            {view === 'mine' ? 'No agents are assigned to you. Switch to Team view to see everyone.' : 'No active agents.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '420px' }}>
              <thead><tr><th style={th}>Team / channel</th><th style={th}>Agents</th><th style={th}>Target</th><th style={th}>Done</th><th style={th} /></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.group}>
                    <td style={td}>{g.group}</td><td style={td}>{g.agents}</td><td style={td}>{g.target}</td><td style={td}>{g.done}</td>
                    <td style={{ ...td, fontSize: '11px', color: 'var(--text-muted)' }}>{g.withoutTarget > 0 ? `${g.withoutTarget} without a target` : ''}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, fontWeight: 700 }}>Total</td><td style={{ ...td, fontWeight: 700 }}>{total.agents}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{total.target}</td><td style={{ ...td, fontWeight: 700 }}>{total.done}</td><td style={td} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={card} aria-label="Agents to audit">
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Who to audit next</h2>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 12px' }}>
          Highest priority first: critical fatal error, then PIP, longest zero-seller streak, Red before Yellow before Green, then lowest revenue achievement.
          Revenue is in US dollars.
        </p>
        <AgentQueueTable
          ranked={ranked}
          reTraining={reTraining}
          agentProfileHref={(id) => `/audits/agent/${encodeURIComponent(id)}/profile`}
          action={{ label: 'Audit', href: (id) => `/audits/agent/${encodeURIComponent(id)}` }}
        />
      </section>
    </>
  )
}
