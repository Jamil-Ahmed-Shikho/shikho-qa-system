import Link from 'next/link'
import { BackLink } from '@/components/common/BackLink'
import { getAuthUser } from '@/lib/auth/auth.service'
import {
  canNarrowByManager,
  listMistakeOptions,
  listReportCampaigns,
  listReportManagers,
  loadCampaignMistakeBreakdown,
  loadCampaignReport,
  loadReportParticipants,
  MISTAKE_REPORT_SEND_ROLES,
  type ReportFilters,
} from '@/lib/campaigns/report.service'
import { SITE_NAMES } from '@/lib/users/constants'
import { TEAM_NAMES } from '@/types/database.types'
import { CampaignReportView, selectStyle } from '@/components/reports/CampaignReportView'
import { MistakeBreakdownTable, MistakeFilterFields } from '@/components/reports/CampaignMistakeSection'
import { SendMistakeReportButton } from '@/components/reports/SendMistakeReportButton'
import { MistakeReportSendLog } from '@/components/reports/MistakeReportSendLog'
import { loadMistakeReportSendLog } from '@/lib/campaigns/mistake-report-actions'

type SP = Record<string, string | undefined> & { mistakeValues?: string | string[] }

export default async function CampaignReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const user = await getAuthUser()

  const campaigns = await listReportCampaigns()
  if (campaigns.length === 0) {
    return (
      <div>
        <BackLink href="/dashboard" label="Dashboard" />
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Special Check Report</h1>
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px', marginTop: '16px' }}>
          No Special Checks exist yet.
        </div>
      </div>
    )
  }

  const selectedId = campaigns.find((c) => c.tree.id === sp.campaign)?.tree.id ?? campaigns[0].tree.id
  const managers = user ? await listReportManagers(user) : []
  // Manager and Team Lead are always locked to their own scope and never
  // see the "which manager's chain" picker — see canNarrowByManager().
  const canPickManager = user ? canNarrowByManager(user.role) : false

  const filters: ReportFilters = {
    managerId: canPickManager ? sp.manager || null : null,
    team: sp.team || null,
    site: sp.site || null,
    agentId: sp.agent || null,
    auditorId: sp.auditor || null,
    from: sp.from || null,
    to: sp.to || null,
  }

  const [participants, report] = await Promise.all([
    loadReportParticipants(selectedId, filters.managerId ?? null),
    loadCampaignReport(selectedId, filters),
  ])

  // "Count as a mistake" checklist: null = nothing explicit yet (default to every mistake-
  // tagged option); an explicit (possibly empty) array once the form has been submitted at
  // least once — see MistakeFilterFields' own hidden marker for why a marker is needed at all.
  const mistakeOptions = report ? listMistakeOptions(report) : []
  const selectedValueIds: string[] | null = sp.mistakeFilterTouched === '1'
    ? (Array.isArray(sp.mistakeValues) ? sp.mistakeValues : sp.mistakeValues ? [sp.mistakeValues] : [])
    : null
  const mistakeRows = report && mistakeOptions.length > 0
    ? await loadCampaignMistakeBreakdown(selectedId, filters, selectedValueIds)
    : []

  // A Manager can't open /audits/{id} or /audits/agent/{id}/profile (§9 Part 2 — "a Manager
  // doesn't audit calls"); everyone else allowed on this report can.
  const isManager = user?.role === 'manager'
  const agentProfileHref = (agentId: string) => (isManager ? `/dashboard/manager/agent/${agentId}` : `/audits/agent/${agentId}/profile`)

  const canSendReport = !!user && (MISTAKE_REPORT_SEND_ROLES as readonly string[]).includes(user.role)
  const sendLog = canSendReport && mistakeOptions.length > 0 ? await loadMistakeReportSendLog(selectedId) : []

  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '4px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Special Check Report</h1>
        <Link href="/admin/campaigns" style={{ fontSize: '13px', color: 'var(--brand)', textDecoration: 'none', fontWeight: 500 }}>
          Manage Special Checks →
        </Link>
      </div>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
        How agents answered a Special Check, over submitted audits only. Never part of the score.
      </p>

      {/* GET form: every filter submits together, so the page renders server-side with no client state. */}
      <form
        method="get"
        style={{
          display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end',
          background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '20px',
        }}
      >
        <Field label="Special Check">
          <select name="campaign" defaultValue={selectedId} style={selectStyle}>
            {campaigns.map((c) => (
              <option key={c.tree.id} value={c.tree.id}>{c.tree.name}{c.tree.is_archived ? ' (archived)' : ''}</option>
            ))}
          </select>
        </Field>
        {canPickManager && managers.length > 0 && (
          <Field label="Manager">
            <select name="manager" defaultValue={sp.manager ?? ''} style={selectStyle}>
              <option value="">All managers</option>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role === 'qa_manager' ? ' (QA Manager)' : ''}</option>)}
            </select>
          </Field>
        )}
        <Field label="Team">
          <select name="team" defaultValue={sp.team ?? ''} style={selectStyle}>
            <option value="">All teams</option>
            {TEAM_NAMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Site">
          <select name="site" defaultValue={sp.site ?? ''} style={selectStyle}>
            <option value="">All sites</option>
            {SITE_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Agent">
          <select name="agent" defaultValue={sp.agent ?? ''} style={selectStyle}>
            <option value="">All agents</option>
            {participants.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="QA auditor">
          <select name="auditor" defaultValue={sp.auditor ?? ''} style={selectStyle}>
            <option value="">All auditors</option>
            {participants.auditors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Submitted from">
          <input type="date" name="from" defaultValue={sp.from ?? ''} style={selectStyle} />
        </Field>
        <Field label="Submitted to">
          <input type="date" name="to" defaultValue={sp.to ?? ''} style={selectStyle} />
        </Field>
        <MistakeFilterFields options={mistakeOptions} selectedValueIds={selectedValueIds} />
        <button type="submit" style={{
          padding: '9px 18px', fontSize: '13px', fontWeight: 600, color: 'white', background: 'var(--brand)',
          border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        }}>
          Apply filters
        </button>
        {(sp.manager || sp.team || sp.site || sp.agent || sp.auditor || sp.from || sp.to || sp.mistakeFilterTouched) && (
          <Link
            href={`/reports/campaigns?campaign=${selectedId}`}
            style={{ fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'none', padding: '9px 4px' }}
          >
            Clear filters
          </Link>
        )}
      </form>

      {report ? (
        <>
          <CampaignReportView report={report} />
          <MistakeBreakdownTable
            options={mistakeOptions}
            rows={mistakeRows}
            agentProfileHref={agentProfileHref}
            auditLinksEnabled={!isManager}
          />
          {mistakeOptions.length > 0 && canSendReport && (
            <>
              <SendMistakeReportButton campaignId={selectedId} filters={filters} valueIds={selectedValueIds} />
              <MistakeReportSendLog entries={sendLog} />
            </>
          )}
        </>
      ) : (
        <div style={{ background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-md)', padding: '16px', color: 'var(--alert)', fontSize: '13px' }}>
          That Special Check no longer exists.
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
      {label}
      {children}
    </label>
  )
}
