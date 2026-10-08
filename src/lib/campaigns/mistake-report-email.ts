// ============================================================
// SHIKHO QA SYSTEM — Special Check Mistake Report email (2026-10-04, corrected
// same day on Jamil's feedback: "the report should be a completed report
// not the mistake part only" — the full answer-distribution analysis, the
// same thing CampaignReportView shows on screen, now comes first, exactly
// as it's titled there; "Who to take care of" follows it, not instead of it.
//
// Pure: data in, subject/html/text out. Every interpolated name/label is
// escaped.
// ============================================================

import { BRAND, emailShell, escapeHtml } from '@/lib/users/mailer'
import { formatDhakaDateTime } from '@/lib/dates/format'
import type { CampaignReportResult, MistakeRow } from './report.service'

const MUTED = BRAND.footerMuted
const ALERT = BRAND.coral
const SURFACE = BRAND.surface

export interface MistakeReportEmailInput {
  campaignName: string
  campaignArchived: boolean
  auditCount: number
  checks: CampaignReportResult['checks']
  /** e.g. "1 Oct – 4 Oct 2026" or "All time" when no date filter was applied. */
  periodLabel: string
  /** Which checks/options were counted as a mistake this run, e.g. "Mentioned the promo? — No". */
  countedAsMistake: string[]
  mistakeRows: MistakeRow[]
  /** Link to the live, filterable report — null when the app URL isn't configured. */
  url: string | null
}

export function mistakeReportSubject(i: MistakeReportEmailInput): string {
  return `Special Check Report | ${i.campaignName} | ${i.periodLabel}`
}

const pct = (count: number, total: number) => (total > 0 ? Math.round((count / total) * 100) : 0)

export function mistakeReportText(i: MistakeReportEmailInput): string {
  const lines = [
    `Special Check report — ${i.campaignName}`,
    i.periodLabel,
    `${i.auditCount} submitted audit${i.auditCount === 1 ? '' : 's'} had this Special Check attached.`,
    '',
  ]
  for (const check of i.checks) {
    lines.push(check.name.toUpperCase(), `${check.total} answer${check.total === 1 ? '' : 's'}`)
    if (check.total === 0) {
      lines.push('(no answers yet for the current filters)')
    } else {
      for (const o of check.options) lines.push(`  ${o.label}: ${o.count} (${pct(o.count, check.total)}%)`)
    }
    lines.push('')
  }

  lines.push('WHO TO TAKE CARE OF', `Counted as a mistake: ${i.countedAsMistake.join(', ') || '(none selected)'}`, '')
  if (i.mistakeRows.length === 0) {
    lines.push('No mistakes matching this report.')
  } else {
    lines.push('AGENT — TEAM LEADER — MATCHING CURRENT FILTERS — LIFETIME IN SPECIAL CHECK — MOST RECENT')
    for (const r of i.mistakeRows) {
      const repeat = r.lifetimeCount >= 2 ? ' [REPEAT]' : ''
      lines.push(`- ${r.agentName} — ${r.teamLeaderName ?? '—'} — ${r.mistakeCount} — ${r.lifetimeCount}${repeat} — ${r.lastMistakeAt ? formatDhakaDateTime(r.lastMistakeAt) : '—'}`)
    }
  }
  if (i.url) lines.push('', `Open the live report: ${i.url}`)
  return lines.join('\n')
}

// A table-based "bar" — the same robust technique used across email clients that don't
// support flex/grid (Outlook desktop included): two cells, the filled one colored and
// sized by percentage width, the rest left empty.
function barRow(label: string, count: number, total: number, archived: boolean): string {
  const p = pct(count, total)
  const td = 'padding:6px 0;font-size:12.5px;vertical-align:middle'
  return `<tr>
    <td style="${td};width:38%;padding-right:10px;color:#2A2E3D">${escapeHtml(label)}${archived ? ' <span style="color:#898EA4;font-size:10px">(archived)</span>' : ''}</td>
    <td style="${td};width:42%;padding-right:10px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#EEF0F6;border-radius:8px;overflow:hidden">
        <tr><td style="width:${p}%;background:${BRAND.indigo};height:12px;font-size:1px;line-height:1px">&nbsp;</td><td style="font-size:1px;line-height:1px">&nbsp;</td></tr>
      </table>
    </td>
    <td style="${td};width:20%;text-align:right;white-space:nowrap;color:#5A5F76;font-variant-numeric:tabular-nums">${count} · ${p}%</td>
  </tr>`
}

function checkCardHtml(check: CampaignReportResult['checks'][number]): string {
  const rows = check.total === 0
    ? `<tr><td style="padding:4px 0;font-size:12.5px;color:${MUTED}">No answers yet for the current filters.</td></tr>`
    : check.options.map((o) => barRow(o.label, o.count, check.total, o.archived)).join('')
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${SURFACE};border:1px solid #E3E6F0;border-radius:12px;padding:12px 16px;margin-bottom:12px">
      <tr><td colspan="3" style="padding:0 0 8px">
        <span style="font-size:13px;font-weight:700;color:#1A1D29">${escapeHtml(check.name)}</span>
        ${check.archived ? ' <span style="color:#898EA4;font-size:10px">(archived)</span>' : ''}
        <span style="float:right;font-size:11px;color:${MUTED}">${check.total} answer${check.total === 1 ? '' : 's'}</span>
      </td></tr>
      ${rows}
    </table>`
}

export function mistakeReportHtml(i: MistakeReportEmailInput): string {
  const td = 'padding:8px 10px;border-bottom:1px solid #EEF0F6;font-size:13px;vertical-align:top'
  const th = 'text-align:left;padding:6px 10px;border-bottom:2px solid #DFE1EA;font-size:11px;color:#898EA4;text-transform:uppercase;letter-spacing:.04em'
  const mistakeRows = i.mistakeRows
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

  const mistakeTable = i.mistakeRows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 18px">
         <tr><th style="${th}">Agent</th><th style="${th}">Team Leader</th><th style="${th}">Matching current filters</th><th style="${th}">Lifetime in Special Check</th><th style="${th}">Most recent</th></tr>
         ${mistakeRows}
       </table>`
    : `<p style="margin:0 0 18px;font-size:13px;color:${MUTED}">No mistakes matching this report.</p>`

  const link = i.url
    ? `<a href="${escapeHtml(i.url)}" style="display:inline-block;background:${BRAND.indigo};color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600;font-size:13px">Open the live report</a>`
    : ''

  const body = `
    <p style="margin:0 0 6px"><b>${escapeHtml(i.campaignName)}</b>${i.campaignArchived ? ' <span style="color:#898EA4;font-size:11px">(archived)</span>' : ''}</p>
    <p style="margin:0 0 20px;font-size:13px;color:${MUTED}">${escapeHtml(i.periodLabel)} · ${i.auditCount} submitted audit${i.auditCount === 1 ? '' : 's'} had this Special Check attached</p>

    ${i.checks.map(checkCardHtml).join('')}

    <h3 style="margin:22px 0 4px;font-size:15px;font-weight:700">Who to take care of</h3>
    <p style="margin:0 0 14px;font-size:12.5px;color:${MUTED}">Counted as a mistake: ${i.countedAsMistake.map(escapeHtml).join(', ') || '(none selected)'}</p>
    ${mistakeTable}
    ${link}`

  return emailShell('Special Check report', i.campaignName, 'indigo', body, 640)
}
