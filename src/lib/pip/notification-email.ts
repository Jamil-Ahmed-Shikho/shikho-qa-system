// ============================================================
// SHIKHO QA SYSTEM — PIP publish notification emails (§6.4, Section C, Stage 7)
// Pure: turns already-loaded data into subject + HTML + plain text. Every name
// interpolated is escaped (agent/Team Lead/Manager names come from the users table,
// which is admin-editable free text).
// ============================================================

import { BRAND, emailShell, escapeHtml } from '@/lib/users/mailer'
import type { AgentNotification, StaffNotification } from './notifications'

const ALERT = BRAND.coral

export interface CyclePeriod {
  /** Already formatted for display, e.g. "12 Jan 2027 – 1 Feb 2027". */
  label: string
}

export function fmtUsd(v: number | null): string {
  if (v === null) return 'not set'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Agent email ──────────────────────────────────────────────────────────────────
export interface AgentEmailInput extends CyclePeriod {
  n: AgentNotification
  achievementUsd: number | null // null = could not be computed; never a false zero
}

export function agentNotificationSubject(i: AgentEmailInput): string {
  return `PIP Notice | ${i.n.recipient.name} | ${i.label}`
}

export function agentNotificationText(i: AgentEmailInput): string {
  const lines = [
    `Hi ${i.n.recipient.name},`,
    '',
    `You have been placed on a Performance Improvement Plan (PIP) for ${i.label}.`,
    '',
    `Target: ${fmtUsd(i.n.targetRevenue)}`,
    `Achievement so far: ${i.achievementUsd === null ? 'could not be loaded' : fmtUsd(i.achievementUsd)}`,
  ]
  if (i.n.incentiveDowngraded) lines.push('', 'Your incentive slab has been downgraded due to being on this PIP.')
  lines.push('', 'Speak with your Team Leader if you have questions about this.')
  return lines.join('\n')
}

function appUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL
  return base ? base.replace(/\/$/, '') : null
}

function ctaButton(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${BRAND.indigo};color:#fff;text-decoration:none;padding:11px 24px;border-radius:999px;font-weight:600;font-size:13px">${escapeHtml(text)}</a>`
}

export function agentNotificationHtml(i: AgentEmailInput): string {
  const downgrade = i.n.incentiveDowngraded
    ? `<p style="margin:16px 0 0;font-size:13px;color:${ALERT}"><b>Your incentive slab has been downgraded</b> due to being on this PIP.</p>`
    : ''
  const url = appUrl()
  const body = `
    <p style="margin:0 0 16px">Hi ${escapeHtml(i.n.recipient.name)},</p>
    <p style="margin:0 0 16px">You have been placed on a Performance Improvement Plan (PIP) for <b>${escapeHtml(i.label)}</b>.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:#F4F5FA;border-radius:12px;padding:16px 20px;width:100%;margin-bottom:4px">
      <tr><td style="font-size:12px;color:#5A5F76;padding-bottom:2px">Target</td></tr>
      <tr><td style="font-size:18px;font-weight:700;padding-bottom:12px">${fmtUsd(i.n.targetRevenue)}</td></tr>
      <tr><td style="font-size:12px;color:#5A5F76;padding-bottom:2px">Achievement so far</td></tr>
      <tr><td style="font-size:18px;font-weight:700">${i.achievementUsd === null ? '<span style="font-size:13px;font-weight:400;color:#898EA4">could not be loaded</span>' : fmtUsd(i.achievementUsd)}</td></tr>
    </table>
    ${downgrade}
    <p style="margin:16px 0 20px;font-size:13px;color:#5A5F76">Speak with your Team Leader if you have questions about this.</p>
    ${url ? `<div style="text-align:center">${ctaButton(`${url}/dashboard`, 'View in portal')}</div>` : ''}`
  return emailShell('Performance Improvement Plan', i.label, 'sunrise', body, 480)
}

// ── Team Lead / Manager email ────────────────────────────────────────────────────
export interface StaffEmailInput extends CyclePeriod {
  n: StaffNotification
}

export function staffNotificationSubject(i: StaffEmailInput): string {
  return `PIP List Published | ${i.n.total} ${i.n.total === 1 ? 'Agent' : 'Agents'} | ${i.label}`
}

export function staffNotificationText(i: StaffEmailInput): string {
  const lines = [
    `Hi ${i.n.recipient.name},`,
    '',
    `A PIP list has been published for ${i.label}. The following ${i.n.total === 1 ? 'person of yours is' : 'people of yours are'} on it:`,
    '',
  ]
  for (const g of i.n.groups) {
    if (g.teamLeadName) lines.push(`${g.teamLeadName}:`)
    for (const name of g.agentNames) lines.push(`${g.teamLeadName ? '  ' : ''}- ${name}`)
  }
  return lines.join('\n')
}

export function staffNotificationHtml(i: StaffEmailInput): string {
  const list = i.n.groups
    .map((g) => {
      const items = g.agentNames.map((n) => `<li style="margin:0 0 4px">${escapeHtml(n)}</li>`).join('')
      return g.teamLeadName
        ? `<p style="margin:12px 0 4px;font-weight:600;font-size:13px">${escapeHtml(g.teamLeadName)}</p><ul style="margin:0 0 4px;padding-left:18px;font-size:13px">${items}</ul>`
        : `<ul style="margin:0;padding-left:18px;font-size:13px">${items}</ul>`
    })
    .join('')
  const url = appUrl()
  const body = `
    <p style="margin:0 0 16px">Hi ${escapeHtml(i.n.recipient.name)},</p>
    <p style="margin:0 0 8px">A PIP list has been published for <b>${escapeHtml(i.label)}</b>. The following
      ${i.n.total === 1 ? 'person of yours is' : 'people of yours are'} on it:</p>
    ${list}
    ${url ? `<div style="text-align:center;margin-top:18px">${ctaButton(`${url}/dashboard`, 'View in portal')}</div>` : ''}`
  return emailShell('PIP list published', i.label, 'indigo', body, 480)
}
