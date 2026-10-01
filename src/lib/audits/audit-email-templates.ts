// ============================================================
// SHIKHO QA SYSTEM — audit-submitted email content (pure: data in, subject/
// html/text out). Every interpolated name/feedback string is escaped —
// agent/auditor names and QA feedback are both user-editable free text.
// ============================================================

import { emailShell, escapeHtml } from '@/lib/users/mailer'
import { formatDhakaDateTime } from '@/lib/dates/format'
import type { AuditEmailData } from './audit-notifications'

const GREEN = '#1F9D5A'
const AMBER = '#B07A05'
const ALERT = '#E03050'
const MUTED = '#898EA4'
const SURFACE = '#F4F5FA'

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

function detailRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 14px 6px 0;font-size:12px;color:${MUTED};white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:6px 0;font-size:13px;font-weight:600;vertical-align:top">${value}</td>
  </tr>`
}

function ctaButton(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:#304090;color:#fff;text-decoration:none;padding:11px 24px;border-radius:999px;font-weight:600;font-size:13px">${escapeHtml(text)}</a>`
}

// ── Agent's own result email (To: agent, Cc: Team Leader) ─────────────────────

export function auditResultSubject(d: AuditEmailData): string {
  return `Your audit result: ${d.scorePercent}% — ${resultLabel(d)}`
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
    ? `<h3 style="margin:24px 0 10px;font-size:14px;font-weight:700;color:${ALERT}">Fatal errors</h3>` +
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
    ? `<h3 style="margin:24px 0 8px;font-size:14px;font-weight:700">Overall feedback</h3>
       <p style="margin:0;font-size:13px;color:#2A2E3D;background:${SURFACE};border-radius:10px;padding:12px 16px">${escapeHtml(d.overallFeedback)}</p>`
    : ''

  const leadLink = d.crmLeadId
    ? `<a href="https://crm.shikho.com/leads/${escapeHtml(d.crmLeadId)}" style="color:#304090;text-decoration:none;font-size:12.5px;font-weight:600">View lead in CRM →</a>`
    : ''

  const body = `
    <p style="margin:0 0 16px">Hi ${escapeHtml(d.agentName)},</p>
    <p style="margin:0 0 20px">Your recent call was audited. Here is the result.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:20px">
      <tr>
        <td style="vertical-align:middle">
          <div style="font-size:40px;font-weight:700;color:${color};line-height:1">${d.scorePercent}%</div>
        </td>
        <td style="vertical-align:middle;text-align:right">
          <span style="display:inline-block;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700;color:#fff;background:${color}">${resultLabel(d).toUpperCase()}</span>
        </td>
      </tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${SURFACE};border-radius:12px;padding:4px 16px;margin-bottom:20px">
      ${detailRow('Call date', d.callStartedAt ? formatDhakaDateTime(d.callStartedAt) : '—')}
      ${detailRow('Audited by', escapeHtml(d.auditorName))}
      ${detailRow('Rubric', escapeHtml(d.rubricName))}
    </table>
    ${leadLink ? `<div style="margin:-12px 0 20px">${leadLink}</div>` : ''}

    <h3 style="margin:0 0 10px;font-size:14px;font-weight:700">Performance breakdown</h3>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-bottom:8px">
      ${paramRows}
    </table>

    ${fatalsHtml}
    ${overallFeedback}

    <div style="margin-top:26px;text-align:center">
      ${ctaButton(appUrl(`/my-audits/${d.auditId}`), 'View full result & request a review')}
    </div>`

  return emailShell('New audit result', body, 560)
}

export function auditResultText(d: AuditEmailData): string {
  const lines = [
    `Hi ${d.agentName},`,
    '',
    `Your recent call was audited. Result: ${d.scorePercent}% — ${resultLabel(d)}`,
    '',
    `Call date: ${d.callStartedAt ? formatDhakaDateTime(d.callStartedAt) : '—'}`,
    `Audited by: ${d.auditorName}`,
    `Rubric: ${d.rubricName}`,
    '',
    'Performance breakdown:',
  ]
  for (const p of d.parameters) {
    lines.push(`  ${p.passed ? 'PASS' : 'FAIL'}  ${p.name} (${p.pointsAwarded}/${p.points})${!p.passed && p.feedback ? ` — ${p.feedback}` : ''}`)
  }
  if (d.fatals.length) {
    lines.push('', 'Fatal errors:')
    for (const f of d.fatals) lines.push(`  [${f.severity.toUpperCase()}] ${f.description}${f.feedback ? ` — ${f.feedback}` : ''}`)
  }
  if (d.overallFeedback) lines.push('', 'Overall feedback:', d.overallFeedback)
  lines.push('', `View full result: ${appUrl(`/my-audits/${d.auditId}`)}`)
  return lines.join('\n')
}

// ── Manager / QA Manager alert (Red or critical-fatal audits only) ────────────

export function redFatalAlertSubject(d: AuditEmailData): string {
  return d.criticalFail
    ? `Critical fatal error — ${d.agentName}'s audit (${d.scorePercent}%)`
    : `Red audit alert — ${d.agentName} scored ${d.scorePercent}%`
}

export function redFatalAlertHtml(recipientName: string, d: AuditEmailData): string {
  const reason = d.criticalFail
    ? 'This audit was flagged with a critical fatal error.'
    : `This audit scored below the pass mark (${d.scorePercent}%, pass mark ${d.passMarkUsed}%).`

  const fatalsHtml = d.fatals.filter((f) => f.severity === 'critical').length
    ? d.fatals
        .filter((f) => f.severity === 'critical')
        .map(
          (f) => `<div style="background:#FDEBEE;border:1px solid ${ALERT};border-radius:10px;padding:12px 16px;margin-bottom:8px">
            <div style="font-size:13px;font-weight:600;margin:0 0 2px">${escapeHtml(f.description)}</div>
            ${f.feedback ? `<div style="font-size:12.5px;color:#5A5F76">${escapeHtml(f.feedback)}</div>` : ''}
          </div>`
        )
        .join('')
    : ''

  const body = `
    <p style="margin:0 0 16px">Hi ${escapeHtml(recipientName)},</p>
    <p style="margin:0 0 20px;color:${ALERT};font-weight:600">${escapeHtml(reason)}</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${SURFACE};border-radius:12px;padding:4px 16px;margin-bottom:20px">
      ${detailRow('Agent', escapeHtml(d.agentName))}
      ${detailRow('Score', `<span style="color:${scoreColor(d)}">${d.scorePercent}%</span>`)}
      ${detailRow('Call date', d.callStartedAt ? formatDhakaDateTime(d.callStartedAt) : '—')}
      ${detailRow('Audited by', escapeHtml(d.auditorName))}
    </table>

    ${fatalsHtml}

    <div style="margin-top:22px;text-align:center">
      ${ctaButton(appUrl(`/audits/${d.auditId}`), 'View the audit')}
    </div>`

  return emailShell(d.criticalFail ? 'Critical fatal error' : 'Red audit alert', body, 520)
}

export function redFatalAlertText(recipientName: string, d: AuditEmailData): string {
  const reason = d.criticalFail
    ? 'This audit was flagged with a critical fatal error.'
    : `This audit scored below the pass mark (${d.scorePercent}%, pass mark ${d.passMarkUsed}%).`
  const lines = [
    `Hi ${recipientName},`,
    '',
    reason,
    '',
    `Agent: ${d.agentName}`,
    `Score: ${d.scorePercent}%`,
    `Call date: ${d.callStartedAt ? formatDhakaDateTime(d.callStartedAt) : '—'}`,
    `Audited by: ${d.auditorName}`,
  ]
  for (const f of d.fatals.filter((f) => f.severity === 'critical')) {
    lines.push('', f.description + (f.feedback ? ` — ${f.feedback}` : ''))
  }
  lines.push('', `View the audit: ${appUrl(`/audits/${d.auditId}`)}`)
  return lines.join('\n')
}
