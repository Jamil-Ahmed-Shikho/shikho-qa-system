// ============================================================
// SHIKHO QA SYSTEM — Campaign Mistake Report email (2026-10-04)
// Pure: data in, subject/html/text out. Same shape as the on-screen "Who to
// take care of" table (CampaignMistakeSection.tsx) — this is a snapshot of
// exactly what the report showed when "Send report" was pressed, not a
// separate computation. Every interpolated name/label is escaped.
// ============================================================

import { BRAND, emailShell, escapeHtml, subjectLine } from '@/lib/users/mailer'
import { formatDhakaDateTime } from '@/lib/dates/format'
import type { MistakeRow } from './report.service'

const MUTED = BRAND.footerMuted
const ALERT = BRAND.coral

export interface MistakeReportEmailInput {
  campaignName: string
  /** e.g. "1 Oct – 4 Oct 2026" or "All time" when no date filter was applied. */
  periodLabel: string
  /** Which checks/options were counted this run, e.g. "Mentioned the promo? — No". */
  countedAsMistake: string[]
  rows: MistakeRow[]
  /** Link to the live, filterable report — null when the app URL isn't configured. */
  url: string | null
}

export function mistakeReportSubject(i: MistakeReportEmailInput): string {
  return subjectLine(`Campaign mistake report: ${i.campaignName}`)
}

export function mistakeReportText(i: MistakeReportEmailInput): string {
  const lines = [
    `Campaign mistake report — ${i.campaignName}`,
    i.periodLabel,
    `Counted as a mistake: ${i.countedAsMistake.join(', ') || '(none selected)'}`,
    '',
  ]
  if (i.rows.length === 0) {
    lines.push('No mistakes matching this report.')
  } else {
    lines.push('AGENT — TEAM LEADER — IN THIS VIEW — LIFETIME — MOST RECENT')
    for (const r of i.rows) {
      const repeat = r.lifetimeCount >= 2 ? ' [REPEAT]' : ''
      lines.push(`- ${r.agentName} — ${r.teamLeaderName ?? '—'} — ${r.mistakeCount} — ${r.lifetimeCount}${repeat} — ${r.lastMistakeAt ? formatDhakaDateTime(r.lastMistakeAt) : '—'}`)
    }
  }
  if (i.url) lines.push('', `Open the live report: ${i.url}`)
  return lines.join('\n')
}

export function mistakeReportHtml(i: MistakeReportEmailInput): string {
  const td = 'padding:8px 10px;border-bottom:1px solid #EEF0F6;font-size:13px;vertical-align:top'
  const th = 'text-align:left;padding:6px 10px;border-bottom:2px solid #DFE1EA;font-size:11px;color:#898EA4;text-transform:uppercase;letter-spacing:.04em'
  const rows = i.rows
    .map((r) => `<tr>
      <td style="${td}"><b>${escapeHtml(r.agentName)}</b></td>
      <td style="${td};color:#5A5F76">${r.teamLeaderName ? escapeHtml(r.teamLeaderName) : '—'}</td>
      <td style="${td};white-space:nowrap"><b>${r.mistakeCount}</b></td>
      <td style="${td};white-space:nowrap">${r.lifetimeCount}${r.lifetimeCount >= 2 ? ` <span style="color:${ALERT};font-size:10px;font-weight:700">REPEAT</span>` : ''}</td>
      <td style="${td};color:#5A5F76">
        ${r.lastMistakeAt ? escapeHtml(formatDhakaDateTime(r.lastMistakeAt)) : '—'}
        ${r.lastCheckName ? `<div style="font-size:11px;color:${MUTED}">${escapeHtml(r.lastCheckName)} — ${escapeHtml(r.lastValueLabel ?? '')}</div>` : ''}
      </td>
    </tr>`)
    .join('')

  const table = i.rows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 18px">
         <tr><th style="${th}">Agent</th><th style="${th}">Team Leader</th><th style="${th}">In this view</th><th style="${th}">Lifetime</th><th style="${th}">Most recent</th></tr>
         ${rows}
       </table>`
    : `<p style="margin:0 0 18px;font-size:13px;color:${MUTED}">No mistakes matching this report.</p>`

  const link = i.url
    ? `<a href="${escapeHtml(i.url)}" style="display:inline-block;background:${BRAND.indigo};color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600;font-size:13px">Open the live report</a>`
    : ''

  const body = `
    <p style="margin:0 0 6px"><b>${escapeHtml(i.campaignName)}</b></p>
    <p style="margin:0 0 16px;font-size:13px;color:${MUTED}">${escapeHtml(i.periodLabel)}</p>
    <p style="margin:0 0 16px;font-size:12.5px;color:${MUTED}">Counted as a mistake: ${i.countedAsMistake.map(escapeHtml).join(', ') || '(none selected)'}</p>
    ${table}
    ${link}`

  return emailShell('Campaign mistake report', i.campaignName, 'indigo', body, 620)
}
