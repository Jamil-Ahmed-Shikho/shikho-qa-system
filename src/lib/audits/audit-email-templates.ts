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

import { BRAND, emailShell, escapeHtml, type EmailAccent } from '@/lib/users/mailer'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { crmLeadUrl } from '@/lib/crm/lead-id-parser'
import { isLikelyUrl, itemReferenceLabel } from './item-reference'
import { signAuditViewToken } from './view-tracking'
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

// Both the "I've seen this" button and the plain "Open it here" portal link go through the
// click-tracking redirect (schema_092, 2026-10-12) rather than straight to /my-audits/{id} —
// either one is a real click-through, so either should count. See view-tracking.ts.
//
// Renamed from "View full result" (2026-10-14, Jamil's feedback): the email already shows
// every failed parameter, fatal and overall feedback, so "full result" oversold what clicking
// through actually reveals — most of the time, not much. "I've seen this" is honest about what
// the click is really for (the tracked acknowledgement), and the separate portal link next to
// it is there for the one thing that's genuinely only in the portal: requesting a review.
function trackedResultUrl(auditId: string): string {
  return appUrl(`/api/audits/${auditId}/view?t=${signAuditViewToken(auditId)}`)
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
  return `<a href="${escapeHtml(crmLeadUrl(crmLeadId))}" style="display:inline-block;background:#fff;border:1px solid ${INDIGO};color:${INDIGO};text-decoration:none;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600">Open lead →</a>`
}

// A chat/complaint audit has no CRM lead — just the pasted ticket/chat reference (§ item-reference.ts).
function referencePill(itemReference: string, auditType: string): string {
  if (!isLikelyUrl(itemReference)) return `<span style="font-size:12.5px;font-weight:600;color:#1A1D29;word-break:break-all">${escapeHtml(itemReference)}</span>`
  const label = auditType === 'complaint' ? 'Open complaint' : 'Open chat'
  return `<a href="${escapeHtml(itemReference)}" style="display:inline-block;background:#fff;border:1px solid ${INDIGO};color:${INDIGO};text-decoration:none;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600">${label} →</a>`
}

// ── A clean "label | value" card with an uppercase eyebrow title — the same
// shape used for both info cards, so Call Details and Agent Information
// always read as one consistent system, not two different designs. ────────
// Row padding trimmed 2026-10-14 (alongside the side-by-side layout below) —
// a secondary, smaller win toward the same goal: less scroll before "What
// needs attention".
function infoCard(title: string, rows: { label: string; value: string }[]): string {
  const filled = rows.filter((r) => r.value !== '')
  if (filled.length === 0) return ''
  const rowsHtml = filled
    .map(
      (r, i) => `<tr>
        <td style="padding:${i === 0 ? '0 10px 5px 0' : '5px 10px 5px 0'};font-size:12px;color:${MUTED};white-space:nowrap;vertical-align:top;width:1%">${escapeHtml(r.label)}</td>
        <td style="padding:${i === 0 ? '0 0 5px' : '5px 0'};font-size:13px;font-weight:600;color:#1A1D29;vertical-align:top">${r.value}</td>
      </tr>`
    )
    .join('')
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${SURFACE};border:1px solid ${BORDER};border-radius:12px;padding:12px 16px">
      <tr><td colspan="2" style="padding:0 0 7px;font-size:11px;font-weight:700;color:${INDIGO};text-transform:uppercase;letter-spacing:.06em">${escapeHtml(title)}</td></tr>
      ${rowsHtml}
    </table>`
}

// Call Details and Employee Information side by side (2026-10-14, Jamil's feedback: stacked,
// they pushed the actual parameter breakdown too far below the fold). Built as a "fluid
// hybrid" pair of inline-block divs, NOT a <table><td> pair — a rigid two-column table would
// stay two columns even on a phone, where this email's own fluid width (emailShell's
// `max-width:100%`) has already shrunk the whole layout, squeezing values like a long
// Distribution List name into an unreadably narrow column. inline-block + min-width degrades
// gracefully instead: side by side when there's room (desktop/webmail), and the second card
// naturally wraps below the first — back to today's single-column read — the moment the
// container is too narrow to fit both at their minimum width, no media query required (email
// clients, Outlook especially, don't reliably support those). Outlook's own weak inline-block
// support falls back to the same stacked result, not a broken one.
// No whitespace between the two closing/opening tags below — inline-block elements render any
// source whitespace between them as a visible gap, so the deliberate gap comes only from the
// first div's own margin-right.
function sideBySideCards(a: string, b: string): string {
  if (!a && !b) return ''
  if (!a) return `<div style="margin-bottom:14px">${b}</div>`
  if (!b) return `<div style="margin-bottom:14px">${a}</div>`
  return `<div style="display:inline-block;width:48%;min-width:230px;vertical-align:top;margin-right:4%;margin-bottom:14px">${a}</div>` +
    `<div style="display:inline-block;width:48%;min-width:230px;vertical-align:top;margin-bottom:14px">${b}</div>`
}

function callDetailsCard(d: AuditEmailData): string {
  if (d.auditType !== 'call') {
    return infoCard(itemReferenceLabel(d.auditType).replace('reference', 'details'), [
      { label: 'Auditor', value: escapeHtml(d.auditorName) },
      { label: 'Reference', value: d.itemReference ? referencePill(d.itemReference, d.auditType) : '' },
    ])
  }
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

// Matches the subject format the team already recognizes from the previous (Apps
// Script) system — "New Evaluation Arrived | Score: 95% | Md. Rubayet Hasan |
// 1933728342" (the lead's phone number) — with a result tag added only when the
// outcome needs flagging (a plain pass needs no extra word).
export function auditResultSubject(d: AuditEmailData): string {
  const scorePart = d.criticalFail
    ? `Score: ${d.scorePercent}% (Critical Fatal)`
    : !d.passed
      ? `Score: ${d.scorePercent}% (Did Not Pass)`
      : `Score: ${d.scorePercent}%`
  const parts = ['New Evaluation Arrived', scorePart, d.agentName]
  if (d.callDestination) parts.push(d.callDestination)
  else if (d.crmLeadId) parts.push(`Lead ${d.crmLeadId}`)
  else if (d.auditType !== 'call') parts.push(d.auditType === 'complaint' ? 'Complaint' : 'Chat')
  return parts.join(' | ')
}

// Redesigned 2026-10-08 on Jamil's feedback: the full parameter-by-parameter table
// (every PASS included) made the email too long, and a PASS row has nothing anyone
// needs to act on — "View full result" already gives everyone the complete
// breakdown. Only FAILED parameters are listed here now, with a one-line summary so
// the reader still knows how many passed, not just how many didn't. Fatal errors
// also moved from just-above-the-footer to right after the score hero, before Call
// Details — the single most important fact in a failing audit shouldn't be the
// thing someone has to scroll to.
export function auditResultHtml(d: AuditEmailData): string {
  const color = scoreColor(d)
  const failedParams = d.parameters.filter((p) => !p.passed)
  const passedCount = d.parameters.length - failedParams.length

  const paramRows = failedParams
    .map((p) => {
      const feedback = p.feedback
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
          <span style="font-size:11px;font-weight:700;color:${ALERT}">FAIL</span>
        </td>
      </tr>`
    })
    .join('')

  const performanceSection = failedParams.length === 0
    ? `<p style="margin:4px 0 20px;font-size:13px;color:${GREEN};font-weight:600">✓ All ${d.parameters.length} parameters passed.</p>`
    : `<h3 style="margin:4px 0 4px;font-size:14px;font-weight:700">What needs attention</h3>
       <p style="margin:0 0 10px;font-size:12px;color:${MUTED}">${passedCount} of ${d.parameters.length} parameters passed — showing only the ${failedParams.length} that didn't.</p>
       <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-bottom:8px">
         ${paramRows}
       </table>`

  const fatalsHtml = d.fatals.length
    ? `<h3 style="margin:4px 0 10px;font-size:14px;font-weight:700;color:${ALERT}">Fatal errors</h3>` +
      d.fatals
        .map(
          (f) => `<div style="background:#FDEBEE;border:1px solid ${ALERT};border-radius:10px;padding:12px 16px;margin-bottom:8px">
            <div style="font-size:12px;font-weight:700;color:${ALERT};text-transform:uppercase;letter-spacing:.03em">${f.severity}</div>
            <div style="font-size:13px;font-weight:600;margin:4px 0 2px">${escapeHtml(f.description)}</div>
            ${f.feedback ? `<div style="font-size:12.5px;color:#5A5F76">${escapeHtml(f.feedback)}</div>` : ''}
          </div>`
        )
        .join('') + '<div style="margin-bottom:10px"></div>'
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

    ${fatalsHtml}
    ${sideBySideCards(callDetailsCard(d), agentInfoCard(d, false))}

    ${performanceSection}
    ${overallFeedback}

    <p style="margin:24px 0 12px;font-size:12.5px;color:${MUTED};text-align:center">Clicking below lets us know you&rsquo;ve seen this evaluation.</p>
    <div style="text-align:center">
      ${ctaButton(trackedResultUrl(d.auditId), "I've seen this")}
    </div>
    <p style="margin:14px 0 0;font-size:12.5px;color:${MUTED};text-align:center">Want to request a review, or see more in the portal? <a href="${escapeHtml(trackedResultUrl(d.auditId))}" style="color:${INDIGO};font-weight:600;text-decoration:underline">Open it here →</a></p>`

  return emailShell('New audit result', `${resultLabel(d)} · ${d.agentTeamName ?? 'Shikho'}`, scoreAccent(d), body, 580)
}

export function auditResultText(d: AuditEmailData): string {
  const failedParams = d.parameters.filter((p) => !p.passed)
  const passedCount = d.parameters.length - failedParams.length

  const lines = [
    `Hi ${d.agentName},`,
    '',
    `Your recent ${d.auditType === 'call' ? 'call' : d.auditType} was audited. Result: ${d.scorePercent}% — ${resultLabel(d)}`,
    '',
  ]
  if (d.fatals.length) {
    lines.push('FATAL ERRORS')
    for (const f of d.fatals) lines.push(`  [${f.severity.toUpperCase()}] ${f.description}${f.feedback ? ` — ${f.feedback}` : ''}`)
    lines.push('')
  }
  if (d.auditType === 'call') {
    lines.push(
      'CALL DETAILS',
      `Phone number: ${d.callDestination ?? '—'}`,
      `Call date: ${d.callStartedAt ? formatDhakaDateTime(d.callStartedAt) : '—'}`,
      `Call duration: ${durationLabel(d.callStartedAt, d.callEndedAt) ?? '—'}`,
      `Auditor: ${d.auditorName}`,
      ...(d.crmLeadId ? [`Lead: ${crmLeadUrl(d.crmLeadId)}`] : []),
      ''
    )
  } else {
    lines.push(
      itemReferenceLabel(d.auditType).replace('reference', 'details').toUpperCase(),
      `Auditor: ${d.auditorName}`,
      `Reference: ${d.itemReference ?? '—'}`,
      ''
    )
  }
  lines.push(
    'EMPLOYEE INFORMATION',
    `Agent ID: ${d.agentEmpId ?? '—'}`,
    `Team: ${d.agentTeamName ?? '—'}`,
    `Team Leader: ${d.teamLeaderName ?? '—'}`,
    `Vintage: ${d.agentVintageLabel ?? '—'}`,
    `Distribution list: ${d.distributionList ?? '—'}`,
    `Contact stage: ${d.contactStage ?? '—'}`,
    ''
  )
  if (failedParams.length === 0) {
    lines.push(`All ${d.parameters.length} parameters passed.`)
  } else {
    lines.push(`WHAT NEEDS ATTENTION (${passedCount} of ${d.parameters.length} parameters passed — showing only the ${failedParams.length} that didn't)`)
    for (const p of failedParams) lines.push(`  FAIL  ${p.name} (${p.pointsAwarded}/${p.points})${p.feedback ? ` — ${p.feedback}` : ''}`)
  }
  if (d.overallFeedback) lines.push('', 'Overall feedback:', d.overallFeedback)
  lines.push('', "Opening the link below lets us know you've seen this evaluation. It's also where you can request a review or see more in the portal.")
  lines.push(`I've seen this: ${trackedResultUrl(d.auditId)}`)
  return lines.join('\n')
}
