// ============================================================
// SHIKHO QA SYSTEM — audit-submitted email content (pure: data in, subject/
// html/text out). Every interpolated name/feedback string is escaped —
// agent/auditor names and QA feedback are both user-editable free text.
//
// Redesigned 2026-10-02 on Jamil's feedback: the first version dropped the
// identifying context his old (Apps-Script) email always carried — who the
// agent is, their tenure, their Team Leader, which distribution list the
// call came from. Brought back as two clean "Call Details" / "Employee
// Information" cards (same data his old email had, not its look), and the
// rubric name (meaningless to a Manager) replaced with the agent's team.
//
// ONE SINGLE EMAIL per audit (2026-10-03, on Jamil's explicit request) —
// the separate "Manager / QA Manager alert" template this file used to also
// export is gone; a non-passing audit's Manager and every QA Manager are now
// just added to the SAME email's Cc list (scoring-actions.ts), not sent a
// second, differently-worded email. Nothing here needed to change for that —
// the full breakdown this template already renders (call details, employee
// information, every parameter, fatals, overall feedback) is exactly what a
// Cc'd Manager/QA Manager should see too, addressed to the agent as "Hi
// {name}" the same way a Team Lead Cc has always been.
// ============================================================

import { BRAND, emailShell, escapeHtml, subjectLine, type EmailAccent } from '@/lib/users/mailer'
import { formatDhakaDateTime } from '@/lib/dates/format'
import type { AuditEmailData } from './audit-notifications'

// One shared palette (BRAND, mailer.ts) — these are just short local aliases, not a
// second set of colors.
const GREEN = BRAND.green
const ALERT = BRAND.coral
const MUTED = BRAND.footerMuted
const SURFACE = BRAND.surface
const INDIGO = BRAND.indigo
const BORDER = '#E3E6F0'

function scoreColor(d: Pick<AuditEmailData, 'criticalFail' | 'passed'>): string {
  if (d.criticalFail) return ALERT
  return d.passed ? GREEN : ALERT
}

function resultLabel(d: Pick<AuditEmailData, 'criticalFail' | 'passed'>): string {
  if (d.criticalFail) return 'Critical fatal error'
  return d.passed ? 'Passed' : 'Did not pass'
}

function appUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  return base ? `${base}${path}` : path
}

function durationLabel(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return null
  const secs = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000)
  if (!Number.isFinite(secs) || secs < 0) return null
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(h)}:${two(m)}:${two(s)}`
}

function scoreAccent(d: Pick<AuditEmailData, 'criticalFail' | 'passed'>): EmailAccent {
  if (d.criticalFail) return 'coral'
  return d.passed ? 'green' : 'coral'
}

function ctaButton(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${INDIGO};color:#fff;text-decoration:none;padding:11px 24px;border-radius:999px;font-weight:600;font-size:13px">${escapeHtml(text)}</a>`
}

function leadPill(crmLeadId: string | null): string {
  if (!crmLeadId) return `<span style="font-size:12.5px;color:${MUTED}">—</span>`
  return `<a href="https://crm.shikho.com/leads/${escapeHtml(crmLeadId)}" style="display:inline-block;background:#fff;border:1px solid ${INDIGO};color:${INDIGO};text-decoration:none;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600">Open lead →</a>`
}

// ── A clean "label | value" card with an uppercase eyebrow title — the same
// shape used for both info cards, so Call Details and Agent Information
// always read as one consistent system, not two different designs. ────────
function infoCard(title: string, rows: { label: string; value: string }[]): string {
  const filled = rows.filter((r) => r.value !== '')
  if (filled.length === 0) return ''
  const rowsHtml = filled
    .map(
      (r, i) => `<tr>
        <td style="padding:${i === 0 ? '0 10px 7px 0' : '7px 10px 7px 0'};font-size:12px;color:${MUTED};white-space:nowrap;vertical-align:top;width:1%">${escapeHtml(r.label)}</td>
        <td style="padding:${i === 0 ? '0 0 7px' : '7px 0'};font-size:13px;font-weight:600;color:#1A1D29;vertical-align:top">${r.value}</td>
      </tr>`
    )
    .join('')
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${SURFACE};border:1px solid ${BORDER};border-radius:12px;padding:14px 18px;margin-bottom:14px">
      <tr><td colspan="2" style="padding:0 0 8px;font-size:11px;font-weight:700;color:${INDIGO};text-transform:uppercase;letter-spacing:.06em">${escapeHtml(title)}</td></tr>
      ${rowsHtml}
    </table>`
}

function callDetailsCard(d: AuditEmailData): string {
  return infoCard('Call details', [
    { label: 'Phone number', value: d.callDestination ? escapeHtml(d.callDestination) : '' },
    { label: 'Call date', value: d.callStartedAt ? escapeHtml(formatDhakaDateTime(d.callStartedAt)) : '' },
    { label: 'Call duration', value: durationLabel(d.callStartedAt, d.callEndedAt) ?? '' },
    { label: 'Auditor', value: escapeHtml(d.auditorName) },
    { label: 'Lead', value: d.crmLeadId ? leadPill(d.crmLeadId) : '' },
  ])
}

function agentInfoCard(d: AuditEmailData, includeName: boolean): string {
  return infoCard('Employee information', [
    ...(includeName ? [{ label: 'Agent name', value: escapeHtml(d.agentName) }] : []),
    { label: 'Agent ID', value: d.agentEmpId ? escapeHtml(d.agentEmpId) : '' },
    { label: 'Team', value: d.agentTeamName ? escapeHtml(d.agentTeamName) : '' },
    { label: 'Team Leader', value: d.teamLeaderName ? escapeHtml(d.teamLeaderName) : '' },
    { label: 'Vintage', value: d.agentVintageLabel ? escapeHtml(d.agentVintageLabel) : '' },
    { label: 'Distribution list', value: d.distributionList ? escapeHtml(d.distributionList) : '' },
    { label: 'Contact stage', value: d.contactStage ? escapeHtml(d.contactStage) : '' },
  ])
}

// ── Audit result email (To: agent, Cc: Team Leader always, Cc: Manager + QA
// Managers too when the audit didn't pass — see qualifiesForRedFatalAlert) ──

export function auditResultSubject(d: AuditEmailData): string {
  return subjectLine(`Your audit result: ${d.scorePercent}% — ${resultLabel(d)}`)
}

export function auditResultHtml(d: AuditEmailData): string {
  const color = scoreColor(d)
  const paramRows = d.parameters
    .map((p) => {
      const rowColor = p.passed ? GREEN : ALERT
      const feedback = !p.passed && p.feedback
        ? `<div style="margin-top:4px;font-size:12.5px;color:#5A5F76">${escapeHtml(p.feedback)}</div>` : ''
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #EEF0F6;font-size:13px;vertical-align:top">
          <div style="font-weight:600">${escapeHtml(p.name)}</div>
          <div style="font-size:11px;color:${MUTED}">${escapeHtml(p.categoryName)}</div>
          ${feedback}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #EEF0F6;font-size:13px;text-align:right;white-space:nowrap;vertical-align:top">
          <span style="font-weight:700">${p.pointsAwarded}</span><span style="color:${MUTED}">/${p.points}</span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #EEF0F6;text-align:right;vertical-align:top;white-space:nowrap">
          <span style="font-size:11px;font-weight:700;color:${rowColor}">${p.passed ? 'PASS' : 'FAIL'}</span>
        </td>
      </tr>`
    })
    .join('')

  const fatalsHtml = d.fatals.length
    ? `<h3 style="margin:22px 0 10px;font-size:14px;font-weight:700;color:${ALERT}">Fatal errors</h3>` +
      d.fatals
        .map(
          (f) => `<div style="background:#FDEBEE;border:1px solid ${ALERT};border-radius:10px;padding:12px 16px;margin-bottom:8px">
            <div style="font-size:12px;font-weight:700;color:${ALERT};text-transform:uppercase;letter-spacing:.03em">${f.severity}</div>
            <div style="font-size:13px;font-weight:600;margin:4px 0 2px">${escapeHtml(f.description)}</div>
            ${f.feedback ? `<div style="font-size:12.5px;color:#5A5F76">${escapeHtml(f.feedback)}</div>` : ''}
          </div>`
        )
        .join('')
    : ''

  const overallFeedback = d.overallFeedback
    ? `<h3 style="margin:22px 0 8px;font-size:14px;font-weight:700">Overall feedback</h3>
       <p style="margin:0;font-size:13px;color:#2A2E3D;background:${SURFACE};border-radius:10px;padding:12px 16px">${escapeHtml(d.overallFeedback)}</p>`
    : ''

  const body = `
    <p style="margin:0 0 16px">Hi ${escapeHtml(d.agentName)},</p>
    <p style="margin:0 0 20px">Your recent call was audited. Here is the result.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:18px">
      <tr>
        <td style="vertical-align:middle">
          <div style="font-size:40px;font-weight:700;color:${color};line-height:1">${d.scorePercent}%</div>
        </td>
        <td style="vertical-align:middle;text-align:right">
          <span style="display:inline-block;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700;color:#fff;background:${color}">${resultLabel(d).toUpperCase()}</span>
        </td>
      </tr>
    </table>

    ${callDetailsCard(d)}
    ${agentInfoCard(d, false)}

    <h3 style="margin:4px 0 10px;font-size:14px;font-weight:700">Performance breakdown</h3>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-bottom:8px">
      ${paramRows}
    </table>

    ${fatalsHtml}
    ${overallFeedback}

    <p style="margin:24px 0 12px;font-size:12.5px;color:${MUTED};text-align:center">If you think any score here isn't correct, you can request a review from the full result page.</p>
    <div style="text-align:center">
      ${ctaButton(appUrl(`/my-audits/${d.auditId}`), 'View full result')}
    </div>`

  return emailShell('New audit result', `${resultLabel(d)} · ${d.agentTeamName ?? 'Shikho'}`, scoreAccent(d), body, 580)
}

export function auditResultText(d: AuditEmailData): string {
  const lines = [
    `Hi ${d.agentName},`,
    '',
    `Your recent call was audited. Result: ${d.scorePercent}% — ${resultLabel(d)}`,
    '',
    'CALL DETAILS',
    `Phone number: ${d.callDestination ?? '—'}`,
    `Call date: ${d.callStartedAt ? formatDhakaDateTime(d.callStartedAt) : '—'}`,
    `Call duration: ${durationLabel(d.callStartedAt, d.callEndedAt) ?? '—'}`,
    `Auditor: ${d.auditorName}`,
    ...(d.crmLeadId ? [`Lead: https://crm.shikho.com/leads/${d.crmLeadId}`] : []),
    '',
    'EMPLOYEE INFORMATION',
    `Agent ID: ${d.agentEmpId ?? '—'}`,
    `Team: ${d.agentTeamName ?? '—'}`,
    `Team Leader: ${d.teamLeaderName ?? '—'}`,
    `Vintage: ${d.agentVintageLabel ?? '—'}`,
    `Distribution list: ${d.distributionList ?? '—'}`,
    `Contact stage: ${d.contactStage ?? '—'}`,
    '',
    'PERFORMANCE BREAKDOWN',
  ]
  for (const p of d.parameters) {
    lines.push(`  ${p.passed ? 'PASS' : 'FAIL'}  ${p.name} (${p.pointsAwarded}/${p.points})${!p.passed && p.feedback ? ` — ${p.feedback}` : ''}`)
  }
  if (d.fatals.length) {
    lines.push('', 'Fatal errors:')
    for (const f of d.fatals) lines.push(`  [${f.severity.toUpperCase()}] ${f.description}${f.feedback ? ` — ${f.feedback}` : ''}`)
  }
  if (d.overallFeedback) lines.push('', 'Overall feedback:', d.overallFeedback)
  lines.push('', "If you think any score here isn't correct, you can request a review from the full result page.")
  lines.push('', `View full result: ${appUrl(`/my-audits/${d.auditId}`)}`)
  return lines.join('\n')
}
