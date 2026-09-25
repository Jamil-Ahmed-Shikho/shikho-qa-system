import type { CrmLeadSummary } from '@/lib/crm/client'
import type { AgentRevenue } from '@/lib/audits/audit-context.service'
import { formatUsd } from '@/lib/money/usd'

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '16px',
}
const cardTitle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px',
}
const rowLabel: React.CSSProperties = { fontSize: '12px', color: 'var(--text-muted)' }
const note: React.CSSProperties = { fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5, marginTop: '10px' }

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** 'YYYY-MM-DD' (a Saturday) -> "19 Sep – 25 Sep" (that Saturday to the Friday after). */
function weekRange(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number)
  const sat = Date.UTC(y, m - 1, d)
  return `${dayFmt.format(new Date(sat))} – ${dayFmt.format(new Date(sat + 6 * 86_400_000))}`
}

function Value({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <div style={{ fontSize: '14px', fontWeight: muted ? 400 : 600, color: muted ? 'var(--text-muted)' : 'var(--text-primary)', overflowWrap: 'anywhere' }}>{children}</div>
}

/**
 * The lead's CRM context and the agent's revenue, shown beside the audit's
 * own cards. Lead values are the CRM's CURRENT ones (not as at the call);
 * revenue is explicitly labelled as partial because the data is still being
 * loaded and matched — it must not look more authoritative than it is.
 */
export function AuditContextCards({
  showLead = true,
  lead,
  leadUnavailable,
  revenue,
  revenueNeedsUpdate = false,
}: {
  /** false for audits with no CRM lead (chats/complaints) — the lead card would have nothing to say. */
  showLead?: boolean
  lead: CrmLeadSummary | null
  /** The CRM lookup failed (as opposed to the lead simply having no stage / list). */
  leadUnavailable: boolean
  /** null = revenue could not be read. */
  revenue: AgentRevenue | null
  /** Revenue is shown in dollars, which needs schema_029; say so rather than "couldn't load". */
  revenueNeedsUpdate?: boolean
}) {
  return (
    <>
      {showLead && (
      <section style={card} aria-label="Lead">
        <div style={cardTitle}>Lead (from CRM)</div>
        {leadUnavailable ? (
          <Value muted>Couldn&apos;t load the lead from the CRM right now.</Value>
        ) : lead === null ? (
          <Value muted>The CRM has no record of this lead.</Value>
        ) : (
          <>
            <div style={rowLabel}>Contact stage</div>
            {lead.stage ? <Value>{lead.stage}</Value> : <Value muted>None set</Value>}
            <div style={{ ...rowLabel, marginTop: '10px' }}>Distribution list</div>
            {lead.distributionList ? <Value>{lead.distributionList}</Value> : <Value muted>None</Value>}
            <div style={note}>Current values in the CRM, not necessarily as they were at the time of the call.</div>
          </>
        )}
      </section>
      )}

      <section style={card} aria-label="Revenue">
        <div style={{ ...cardTitle, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span>Revenue</span>
          <span style={{
            fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-pill)',
            background: 'var(--highlight-light)', color: 'var(--text-primary)',
            borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--highlight)', letterSpacing: '0.02em', textTransform: 'none',
          }}>
            Partial data
          </span>
        </div>
        {revenueNeedsUpdate ? (
          <Value muted>Revenue in dollars needs a database update (schema_029) before it can be shown.</Value>
        ) : revenue === null ? (
          <Value muted>Couldn&apos;t load revenue right now.</Value>
        ) : (
          <>
            <div style={rowLabel}>Last week ({weekRange(revenue.lastWeek.weekStart)})</div>
            {revenue.lastWeek.totalUsd === null ? (
              <Value muted>Not available yet</Value>
            ) : (
              <Value>{formatUsd(revenue.lastWeek.totalUsd)}</Value>
            )}
            <div style={{ ...rowLabel, marginTop: '10px' }}>This week so far ({weekRange(revenue.currentWeek.weekStart)})</div>
            <Value>{formatUsd(revenue.currentWeek.totalUsd)}</Value>
          </>
        )}
        <div style={note}>
          In US dollars: each sale is converted at the exchange rate in force on the day it was made. Sales are still being loaded
          from the CRM and matched to agents, so these figures can be lower than the real ones. Treat them as indicative, not final.
        </div>
      </section>
    </>
  )
}
