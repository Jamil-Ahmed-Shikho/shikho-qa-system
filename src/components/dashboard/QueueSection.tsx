import Link from 'next/link'
import { isMissingTargetsSchema, loadQueue, type QueueView } from '@/lib/queue/queue.service'
import { groupKey, rankQueue, ratioPct, summarizeTargets, teamGroupOptions, type QueueRow, type TeamGroupOption } from '@/lib/queue/priority'
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

function ViewToggle({ view, base, team }: { view: QueueView; base: string; team: string | null }) {
  const teamQuery = team ? `&team=${encodeURIComponent(team)}` : ''
  const tab = (v: QueueView, text: string) => (
    <Link
      href={`${base}?view=${v}${teamQuery}`}
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

/** "Who to audit next"'s team/channel filter chips — single-select, URL-driven (so the choice
 *  survives a refresh the same way the My view / Team view toggle already does). "All teams" has
 *  no `team` param at all; picking a team/channel chip that doesn't exist in the current My/Team
 *  view scope is simply never offered, and a stale one left over from switching scope falls back
 *  to "All teams" on its own (QueueSection validates `team` against the current `options`). */
function TeamChips({ options, selected, view, base }: { options: TeamGroupOption[]; selected: string | null; view: QueueView; base: string }) {
  const chip = (label: string, href: string, isSelected: boolean, key: string) => (
    <Link
      key={key}
      href={href}
      aria-current={isSelected ? 'page' : undefined}
      style={{
        padding: '6px 14px', fontSize: '13px', textDecoration: 'none', borderRadius: 'var(--radius-pill)',
        borderWidth: '1px', borderStyle: 'solid', whiteSpace: 'nowrap', flexShrink: 0,
        borderColor: isSelected ? 'var(--brand)' : 'var(--border)',
        background: isSelected ? 'var(--brand)' : 'transparent',
        color: isSelected ? '#fff' : 'inherit',
      }}
    >
      {label}
    </Link>
  )
  return (
    <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', marginBottom: '14px' }} role="tablist" aria-label="Filter by team or channel">
      {chip('All teams', `${base}?view=${view}`, selected === null, 'all')}
      {options.map((o) => chip(`${o.group} (${o.pendingCount})`, `${base}?view=${view}&team=${encodeURIComponent(o.group)}`, selected === o.group, o.group))}
    </div>
  )
}

function pctColor(p: number | null): string {
  if (p === null) return 'var(--text-muted)'
  if (p >= 100) return 'var(--status-green)'
  if (p >= 60) return 'var(--highlight)'
  return 'var(--alert)'
}
function PctCell({ value, bold }: { value: number | null; bold?: boolean }) {
  return (
    <td style={{ ...td, color: pctColor(value), fontWeight: bold ? 700 : 600 }}>
      {value === null ? '—' : `${value}%`}
    </td>
  )
}

/**
 * The QA dashboard's target summary + priority-sorted agent queue (§9). The database limits the rows: My view = the
 * auditor's assigned agents, Team view = everyone (a QA Auditor is QA staff, so both are allowed — §2's standing rule).
 */
export async function QueueSection({ view, base, team }: { view: QueueView; base: string; team?: string | null }) {
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

  // "This week's audit target" is always built from the FULL, unfiltered rows — the team chips
  // below only narrow "Who to audit next", never this table (kept deliberately independent).
  const { total, groups } = summarizeTargets(rows)

  // Team/channel chips: options come from the same unfiltered rows (so counts match the target
  // table's own grouping), and a `team` param that no longer matches any option in the CURRENT
  // My/Team view scope is treated as "All teams" rather than erroring or showing a stale filter.
  const teamOptions = teamGroupOptions(rows)
  const selectedTeam = team && teamOptions.some((o) => o.group === team) ? team : null
  const queueRows = selectedTeam ? rows.filter((r) => groupKey(r) === selectedTeam) : rows
  const ranked = rankQueue(queueRows)

  // Re-training agents, appended below the ranked list (2026-10-03, Jamil's request) — never
  // folded into the ranking or the target summary above (their target isn't a weekly number).
  // A load failure here is quietly swallowed (shows nothing extra) rather than breaking the
  // whole queue — this is a supplementary flag, not the main screen. Filtered by the same
  // selected team (matched on their own real team name, not the synthetic "OJT" channel group —
  // re-training is its own stage, §7, never folded into OJT).
  let reTraining: OjtCandidate[] = []
  try {
    const candidates = await loadOjtCandidates(view)
    reTraining = candidates.filter((c) => c.stage === 're_training' && (!selectedTeam || c.teamName === selectedTeam))
  } catch (err) {
    if (!isMissingOjtSchema(err)) console.error('loadOjtCandidates failed:', err)
  }

  return (
    <>
      <section style={card} aria-label="Weekly audit target">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>This week&apos;s audit target</h2>
          <ViewToggle view={view} base={base} team={selectedTeam} />
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 12px' }}>
          Sales week (Saturday–Friday). {view === 'mine' ? 'Agents assigned to you.' : 'Every agent.'} Audit Target is the sum of each agent&apos;s weekly target, including the +1 bonus. Agents Covered counts agents with at least one audit this week, regardless of how many are still owed.
        </p>
        {rows.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            {view === 'mine' ? 'No agents are assigned to you. Switch to Team view to see everyone.' : 'No active agents.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '680px' }}>
              <thead>
                <tr>
                  <th style={th}>Team / channel</th>
                  <th style={th}>Agents</th>
                  <th style={th}>Agents covered</th>
                  <th style={th}>Covered %</th>
                  <th style={th}>Audit target</th>
                  <th style={th}>Audit done</th>
                  <th style={th}>Done %</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.group}>
                    <td style={td}>{g.group}</td>
                    <td style={td}>{g.agents}</td>
                    <td style={td}>{g.covered}</td>
                    <PctCell value={ratioPct(g.covered, g.agents)} />
                    <td style={td}>
                      {g.target}
                      {g.withoutTarget > 0 && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{g.withoutTarget} without a target</div>
                      )}
                    </td>
                    <td style={td}>{g.done}</td>
                    <PctCell value={ratioPct(g.done, g.target)} />
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, fontWeight: 700 }}>Total</td>
                  <td style={{ ...td, fontWeight: 700 }}>{total.agents}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{total.covered}</td>
                  <PctCell value={ratioPct(total.covered, total.agents)} bold />
                  <td style={{ ...td, fontWeight: 700 }}>{total.target}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{total.done}</td>
                  <PctCell value={ratioPct(total.done, total.target)} bold />
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
        {teamOptions.length > 0 && <TeamChips options={teamOptions} selected={selectedTeam} view={view} base={base} />}
        <AgentQueueTable
          ranked={ranked}
          reTraining={reTraining}
          agentProfileHref={(id) => `/audits/agent/${encodeURIComponent(id)}/profile`}
          action={{ label: 'Audit', href: (id) => `/audits/agent/${encodeURIComponent(id)}` }}
          emptyMessage={selectedTeam ? `No agents pending audit in ${selectedTeam}.` : undefined}
        />
      </section>
    </>
  )
}
