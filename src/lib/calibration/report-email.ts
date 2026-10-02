// ============================================================
// SHIKHO QA SYSTEM — Calibration results email (§5, Stage 4)
// Pure: turns a VarianceReport into subject + HTML + plain text. Everything
// interpolated is escaped (names, notes and rubric text are user-editable).
// The same email goes to every participant — by the reveal rule every one of
// them may already see every score once the session is closed.
// ============================================================

import { BRAND, emailShell, escapeHtml, subjectLine } from '@/lib/users/mailer'
import type { VarianceReport } from './variance'

const INDIGO = BRAND.indigo
const CORAL = BRAND.coral

export interface ReportEmailInput {
  title: string
  /** Already formatted in Dhaka time. */
  whenLabel: string
  scope: string
  rubricName: string | null
  report: VarianceReport
  /** Participants who never submitted a score. */
  notSubmitted: string[]
  /** Link to the session, or null when the app URL isn't configured. */
  url: string | null
}

const sign = (n: number) => (n > 0 ? `+${n}` : String(n))

export function reportSubject(i: ReportEmailInput): string {
  return subjectLine(`Calibration report: ${i.title} (${i.whenLabel})`)
}

export function reportText(i: ReportEmailInput): string {
  const r = i.report
  const lines = [
    `Calibration report — ${i.title}`,
    `${i.whenLabel} · ${i.scope}${i.rubricName ? ` · ${i.rubricName}` : ''}`,
    '',
    `${r.count} scores · group average ${r.mean}% · range ${r.min}%–${r.max}% (${r.range} points) · standard deviation ${r.stdDev}`,
    '',
    ...r.participants.map((p) => `- ${p.name}: ${p.scorePercent}% (${sign(p.deviation)} vs average)${p.position === 'highest' ? ' — highest' : p.position === 'lowest' ? ' — lowest' : ''}${p.criticalFail ? ' — critical fatal' : ''}`),
  ]
  if (r.splitParameters.length || r.fatals.some((f) => !f.unanimous)) {
    lines.push('', 'Where the group disagreed:')
    for (const p of r.splitParameters) lines.push(`- ${p.name} (${p.points} pts): Pass — ${p.passed.join(', ')}; Fail — ${p.failed.join(', ')}`)
    for (const f of r.fatals.filter((x) => !x.unanimous)) lines.push(`- ${f.description} (${f.severity}): ticked by ${f.ticked.join(', ')}; not by ${f.notTicked.join(', ')}`)
  } else {
    lines.push('', 'Everyone marked every parameter and fatal error the same way.')
  }
  if (i.notSubmitted.length) lines.push('', `Did not submit a score: ${i.notSubmitted.join(', ')}`)
  if (i.url) lines.push('', `Open the session: ${i.url}`)
  return lines.join('\n')
}

export function reportHtml(i: ReportEmailInput): string {
  const r = i.report
  const td = 'padding:8px 10px;border-bottom:1px solid #EEF0F6;font-size:13px;vertical-align:top'
  const th = 'text-align:left;padding:6px 10px;border-bottom:2px solid #DFE1EA;font-size:11px;color:#898EA4;text-transform:uppercase;letter-spacing:.04em'
  const rows = r.participants
    .map((p) => `<tr>
      <td style="${td}">${escapeHtml(p.name)}${p.criticalFail ? ` <span style="color:${CORAL};font-size:10px;font-weight:700">critical fatal</span>` : ''}</td>
      <td style="${td};white-space:nowrap"><b>${p.scorePercent}%</b></td>
      <td style="${td};white-space:nowrap">${sign(p.deviation)} pts</td>
      <td style="${td};color:#5A5F76">${p.position === 'highest' ? 'Highest' : p.position === 'lowest' ? 'Lowest' : ''}</td>
    </tr>`)
    .join('')
  const splits = [
    ...r.splitParameters.map((p) => `<li style="margin:0 0 6px"><b>${escapeHtml(p.name)}</b> (${p.points} pts) — Pass: ${escapeHtml(p.passed.join(', '))}; Fail: ${escapeHtml(p.failed.join(', '))}</li>`),
    ...r.fatals.filter((f) => !f.unanimous).map((f) => `<li style="margin:0 0 6px"><b>${escapeHtml(f.description)}</b> (${f.severity}) — ticked by ${escapeHtml(f.ticked.join(', '))}; not by ${escapeHtml(f.notTicked.join(', '))}</li>`),
  ]
  const disagreement = splits.length
    ? `<ul style="margin:0 0 16px;padding-left:18px;font-size:13px">${splits.join('')}</ul>`
    : `<p style="margin:0 0 16px;font-size:13px;color:#5A5F76">Everyone marked every parameter and fatal error the same way.</p>`
  const missing = i.notSubmitted.length
    ? `<p style="margin:0 0 16px;font-size:12px;color:#898EA4">Did not submit a score: ${escapeHtml(i.notSubmitted.join(', '))}</p>`
    : ''
  const link = i.url
    ? `<a href="${escapeHtml(i.url)}" style="display:inline-block;background:${INDIGO};color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600;font-size:13px">Open the session</a>`
    : ''
  const body = `
    <p style="margin:0 0 6px"><b>${escapeHtml(i.title)}</b></p>
    <p style="margin:0 0 16px;font-size:13px;color:#5A5F76">${escapeHtml(i.whenLabel)} · ${escapeHtml(i.scope)}${i.rubricName ? ` · ${escapeHtml(i.rubricName)}` : ''}</p>
    <p style="margin:0 0 12px;font-size:13px">${r.count} scores · group average <b>${r.mean}%</b> · range ${r.min}%–${r.max}% (${r.range} points) · standard deviation ${r.stdDev}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 18px">
      <tr><th style="${th}">Participant</th><th style="${th}">Score</th><th style="${th}">Vs average</th><th style="${th}"></th></tr>${rows}
    </table>
    <p style="margin:0 0 6px;font-weight:600;font-size:13px">Where the group disagreed</p>
    ${disagreement}${missing}${link}`
  return emailShell('Calibration report', `${i.title} · ${i.whenLabel}`, 'indigo', body, 560)
}
