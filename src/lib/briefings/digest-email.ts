// ============================================================
// SHIKHO QA SYSTEM — Briefings daily digest, the email (§5, Part C)
// Turns one Digest (already scoped to one recipient by digest.ts) into a
// subject + HTML + plain-text body. Everything interpolated is escaped:
// names come from user-editable profiles.
// ============================================================

import { BRAND, emailShell, escapeHtml, subjectLine } from '@/lib/users/mailer'
import { relativeDayLabel } from './rules'
import type { Digest, DigestRow } from './digest'

const INDIGO = BRAND.indigo
const CORAL = BRAND.coral

function whenWord(d: Digest, now: Date): string {
  // "tomorrow" normally; "today" if the job ran late enough (after midnight Dhaka) that the day has begun.
  const rel = relativeDayLabel(new Date(`${d.ymd}T12:00:00+06:00`), now)
  return rel === 'tomorrow' || rel === 'today' ? rel : `on ${d.dayLabel}`
}

export function digestSubject(d: Digest, now: Date = new Date()): string {
  const n = d.total
  const who = d.recipient.role === 'manager' ? (n === 1 ? 'agent in your teams' : 'agents in your teams') : (n === 1 ? 'of your agents' : 'of your agents')
  return subjectLine(`Coaching sessions ${whenWord(d, now)} (${d.dayLabel}): ${n} ${who}`)
}

function rowHtml(r: DigestRow): string {
  const td = 'padding:8px 10px;border-bottom:1px solid #EEF0F6;font-size:13px;vertical-align:top'
  return `<tr>
    <td style="${td};white-space:nowrap;font-weight:600">${escapeHtml(r.time)}</td>
    <td style="${td}">${escapeHtml(r.agentName)}${r.urgent ? ` <span style="display:inline-block;margin-left:6px;padding:1px 8px;border:1px solid ${CORAL};color:${CORAL};border-radius:999px;font-size:10px;font-weight:700;white-space:nowrap">URGENT — critical fatal</span>` : ''}</td>
    <td style="${td};color:#5A5F76">${r.conductorName ? escapeHtml(r.conductorName) : 'QA team'}</td>
  </tr>`
}

function tableHtml(rows: DigestRow[]): string {
  const th = 'text-align:left;padding:6px 10px;border-bottom:2px solid #DFE1EA;font-size:11px;color:#898EA4;text-transform:uppercase;letter-spacing:.04em'
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 18px">
    <tr><th style="${th}">Time</th><th style="${th}">Agent</th><th style="${th}">Coach</th></tr>
    ${rows.map(rowHtml).join('')}
  </table>`
}

export function digestHtml(d: Digest, now: Date = new Date(), appUrl: string | null = process.env.NEXT_PUBLIC_APP_URL ?? null): string {
  const scope = d.recipient.role === 'manager' ? 'the Team Leaders you manage' : 'your team'
  const intro = `<p style="margin:0 0 16px">Hi ${escapeHtml(d.recipient.name)}, here ${d.total === 1 ? 'is the coaching session' : 'are the coaching sessions'} scheduled ${escapeHtml(whenWord(d, now))} (<b>${escapeHtml(d.dayLabel)}</b>, Dhaka time) for ${scope} — <b>${d.total}</b> in all.</p>`
  const body = d.groups
    .map((g) => `${g.label ? `<div style="font-size:13px;font-weight:700;color:${INDIGO};margin:0 0 6px">${escapeHtml(g.label)}'s team <span style="font-weight:400;color:#898EA4">(${g.rows.length})</span></div>` : ''}${tableHtml(g.rows)}`)
    .join('')
  const link = appUrl ? `<a href="${escapeHtml(appUrl)}" style="display:inline-block;background:${INDIGO};color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600;font-size:13px">Open your dashboard</a>` : ''
  const note = `<p style="margin:0 0 ${link ? '18px' : '0'};font-size:12px;color:#898EA4">For your information only — the QA team schedules these sessions and each agent has already been emailed their own time.</p>`
  return emailShell('Coaching sessions ' + whenWord(d, now), `${d.dayLabel} · ${d.total} session${d.total === 1 ? '' : 's'}`, 'indigo', intro + body + note + link, 600)
}

export function digestText(d: Digest, now: Date = new Date()): string {
  const lines: string[] = [
    `Hi ${d.recipient.name}, here ${d.total === 1 ? 'is the coaching session' : 'are the coaching sessions'} scheduled ${whenWord(d, now)} (${d.dayLabel}, Dhaka time) for ${d.recipient.role === 'manager' ? 'the Team Leaders you manage' : 'your team'} — ${d.total} in all.`,
    '',
  ]
  for (const g of d.groups) {
    if (g.label) lines.push(`${g.label}'s team (${g.rows.length})`)
    for (const r of g.rows) lines.push(`  ${r.time}  ${r.agentName}  — ${r.conductorName ?? 'QA team'}${r.urgent ? '  [URGENT — critical fatal]' : ''}`)
    lines.push('')
  }
  lines.push('For your information only — the QA team schedules these sessions and each agent has already been emailed their own time.')
  return lines.join('\n')
}

export function renderDigest(d: Digest, now: Date = new Date(), appUrl?: string | null) {
  return { subject: digestSubject(d, now), html: digestHtml(d, now, appUrl), text: digestText(d, now) }
}
