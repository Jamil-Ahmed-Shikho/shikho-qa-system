import Link from 'next/link'
import { loadBriefingsView, type BriefingsLoad } from '@/lib/briefings/briefings.service'
import type { BriefingListItem } from '@/lib/briefings/view'
import { formatSlotDay, formatSlotTime, relativeDayLabel } from '@/lib/briefings/rules'

/**
 * Whose calendar this is — changes the heading, the columns and the wording,
 * never the data (the rows are already scoped by the database):
 *  auditor — the person's own sessions        org    — every session (QA Manager / Admin)
 *  scope   — their team / reporting chain     agent  — the agent's own sessions
 */
export type BriefingsAudience = 'auditor' | 'org' | 'scope' | 'agent'

const COPY: Record<BriefingsAudience, { title: string; subtitle: string }> = {
  auditor: { title: 'Your coaching schedule', subtitle: 'Sessions you are conducting.' },
  org: { title: 'Coaching sessions', subtitle: 'Every scheduled session across all auditors.' },
  scope: { title: 'Coaching sessions', subtitle: 'For the agents you are responsible for. View only — scheduling is done by the QA team.' },
  agent: { title: 'My coaching sessions', subtitle: 'Your upcoming and recent coaching sessions.' },
}

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '18px 20px',
}
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.04em', padding: '6px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = { fontSize: '13px', padding: '9px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

function whenText(iso: string, now: Date): string {
  const d = new Date(iso)
  return `${formatSlotDay(d)} · ${formatSlotTime(d)}`
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'alert' | 'muted' | 'green' }) {
  const c = tone === 'alert' ? 'var(--alert)' : tone === 'green' ? 'var(--status-green)' : 'var(--text-muted)'
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-pill)', letterSpacing: '0.02em',
      borderStyle: 'solid', borderWidth: '1px', borderColor: c, color: c, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

function Tile({ label, value, alert = false }: { label: string; value: number | string; alert?: boolean }) {
  return (
    <div style={{
      flex: '1 1 140px', padding: '12px 14px', borderRadius: 'var(--radius-sm)', borderStyle: 'solid', borderWidth: '1px',
      borderColor: alert ? 'var(--alert)' : 'var(--border)', background: alert ? 'var(--alert-light)' : 'var(--surface-0)',
    }}>
      <div style={{ fontSize: '22px', fontWeight: 700, color: alert ? 'var(--alert)' : 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

function AuditLink({ id, canOpen, children }: { id: string; canOpen: boolean; children: React.ReactNode }) {
  return canOpen
    ? <Link href={`/audits/${id}`} style={{ color: 'var(--brand)', fontWeight: 500, textDecoration: 'none' }}>{children}</Link>
    : <>{children}</>
}

function Table({
  items, audience, canOpenAudit, now, showOutcome = false,
}: {
  items: BriefingListItem[]; audience: BriefingsAudience; canOpenAudit: boolean; now: Date; showOutcome?: boolean
}) {
  const showAgent = audience !== 'agent'
  const showConductor = audience !== 'auditor'
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '520px' }}>
        <thead>
          <tr>
            <th style={th}>When</th>
            {showAgent && <th style={th}>Agent</th>}
            {showConductor && <th style={th}>Conducted by</th>}
            <th style={th}>{showOutcome ? 'Outcome' : 'Audit'}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td style={td}>
                <div>{whenText(i.scheduledAt, now)}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{relativeDayLabel(new Date(i.scheduledAt), now)}</div>
              </td>
              {showAgent && <td style={td}>{i.agentName}</td>}
              {showConductor && <td style={td}>{i.conductorName ?? <span style={{ color: 'var(--text-muted)' }}>QA team</span>}</td>}
              <td style={td}>
                <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* A staff prioritisation cue — not something to show the agent. */}
                  {i.priority === 'critical_same_day' && audience !== 'agent' && <Badge tone="alert">URGENT — critical fatal</Badge>}
                  {showOutcome ? (
                    i.status === 'completed'
                      ? (i.attended ? <Badge tone="green">Attended</Badge> : <Badge tone="alert">Did not attend</Badge>)
                      : <Badge tone="muted">Not recorded</Badge>
                  ) : (
                    <AuditLink id={i.auditId} canOpen={canOpenAudit}>{canOpenAudit ? 'Open audit' : ''}</AuditLink>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '13px', fontWeight: 600, margin: '18px 0 6px' }}>{children}</div>
}

/**
 * Loads and shows the signed-in person's slice of coaching sessions. A failed
 * read says so — it never renders as "nothing scheduled".
 */
export async function BriefingsSection({ audience, canOpenAudit = true }: { audience: BriefingsAudience; canOpenAudit?: boolean }) {
  const { title, subtitle } = COPY[audience]
  let load: BriefingsLoad
  try {
    load = await loadBriefingsView()
  } catch (err) {
    console.error(err)
    return (
      <section style={{ ...card, marginTop: '28px' }} aria-label={title}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px' }}>{title}</h2>
        <div style={{ fontSize: '13px', color: 'var(--alert)' }}>
          Coaching sessions could not be loaded right now. This does not mean there are none — try again shortly.
        </div>
      </section>
    )
  }

  return <BriefingsPanel audience={audience} canOpenAudit={canOpenAudit} load={load} />
}

/** The screen itself, given already-loaded data (kept apart from the loader so it can be rendered on its own). */
export function BriefingsPanel({
  audience, canOpenAudit = true, load, now = new Date(),
}: { audience: BriefingsAudience; canOpenAudit?: boolean; load: BriefingsLoad; now?: Date }) {
  const { title, subtitle } = COPY[audience]
  const { view, truncated } = load
  const isAgent = audience === 'agent'
  // The flag is for staff. An agent just sees that a past session has no outcome recorded.
  const flagged = isAgent ? [] : view.needsAttendance
  const past = isAgent ? [...view.needsAttendance, ...view.recent].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()) : view.recent
  const empty = view.upcoming.length === 0 && view.needsAttendance.length === 0 && view.recent.length === 0

  return (
    <section style={{ ...card, marginTop: '28px' }} aria-label={title}>
      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 2px' }}>{title}</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 14px' }}>{subtitle}</p>

      {!isAgent && (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Tile label="Today" value={view.todayCount} />
          <Tile label="Tomorrow" value={view.tomorrowCount} />
          <Tile label="Attendance not marked" value={flagged.length} alert={flagged.length > 0} />
        </div>
      )}

      {truncated && (
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px' }}>
          Showing the first 1,000 sessions — counts may be higher than shown.
        </div>
      )}

      {empty && <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '14px' }}>No coaching sessions scheduled.</div>}

      {flagged.length > 0 && (
        <>
          <Heading><span style={{ color: 'var(--alert)' }}>Attendance not marked ({flagged.length})</span></Heading>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 6px' }}>
            These sessions&apos; time has passed but nobody recorded whether the agent attended. Open the audit to record it.
          </p>
          <Table items={flagged} audience={audience} canOpenAudit={canOpenAudit} now={now} />
        </>
      )}

      {view.upcoming.length > 0 && (
        <>
          <Heading>Upcoming ({view.upcoming.length})</Heading>
          <Table items={view.upcoming} audience={audience} canOpenAudit={canOpenAudit} now={now} />
        </>
      )}

      {past.length > 0 && (
        <>
          <Heading>{isAgent ? 'Past sessions' : 'Recent — last 30 days'}</Heading>
          <Table items={past.slice(0, 15)} audience={audience} canOpenAudit={false} now={now} showOutcome />
        </>
      )}
    </section>
  )
}
