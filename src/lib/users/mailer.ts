// ============================================================
// SHIKHO QA SYSTEM — Account emails (Gmail SMTP via nodemailer)
// Server-only. Explicit host/port (not the 'service' shorthand) —
// the shorthand's DNS/connection behavior doesn't reliably resolve on
// Vercel serverless (CMS lesson).
// ============================================================

import nodemailer from 'nodemailer'

let transporter: nodemailer.Transporter | null = null

function getTransporter() {
  if (transporter) return transporter
  // GMAIL_USER / GMAIL_APP_PASSWORD are the names the CMS uses — accepted
  // as fallbacks so its values can be copied over as-is.
  const user = process.env.GMAIL_SMTP_USER ?? process.env.GMAIL_USER
  const pass = process.env.GMAIL_SMTP_APP_PASSWORD ?? process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) throw new Error('Gmail SMTP credentials are not configured.')

  // Pooled so a bulk import reuses one SMTP connection instead of paying
  // a TLS handshake per email.
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    pool: true,
    maxConnections: 3,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  })
  return transporter
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// One palette, shared by the product UI and every email — not a second "email-only" set
// of colors (a lesson carried over from the Shikho CMS's own email system, 2026-10-02).
// Values match src/app/layout.tsx's CSS custom properties exactly (--brand, --accent,
// --highlight, --alert, --status-green) and CLAUDE.md §15's brand table.
export const BRAND = {
  indigo: '#304090',
  magenta: '#C02080',
  sunrise: '#E0A010',
  coral: '#E03050',
  green: '#2E9E5B',
  ink: '#0F1322',
  muted: '#5A5F76',
  footerMuted: '#898EA4',
  border: '#DFE1EA',
  surface: '#F4F5FA',
} as const

export const PRODUCT_NAME = 'Shikho QA Audit Management System'

/** Every subject line in the system reads "{full product name} — {what happened}" — never
 * the short form a human receives (CMS convention, 2026-10-02) — so an inbox listing several
 * of these emails together is instantly recognizable as one system. */
export function subjectLine(outcome: string): string {
  return `${PRODUCT_NAME} — ${outcome}`
}

export type EmailAccent = 'indigo' | 'green' | 'sunrise' | 'coral'
const ACCENT_COLOR: Record<EmailAccent, string> = { indigo: BRAND.indigo, green: BRAND.green, sunrise: BRAND.sunrise, coral: BRAND.coral }

const FONT = `'Poppins','Hind Siliguri',Arial,sans-serif`

// A colored header band (indigo by default; green/sunrise/coral for a semantically
// different outcome — resolved/success, a caution, or a breach/critical event — the same
// "one shell, color passed in" pattern the CMS uses) with a white title + subtitle, a
// white body card below it, and the wordmark sitting ABOVE the whole card rather than
// inside it, so it reads correctly against any header color. Table-based, inline-styled
// throughout (no CSS flexbox/grid, no <style> block) for Outlook/Gmail compatibility.
// appUrl must be an absolute, publicly reachable URL (NEXT_PUBLIC_APP_URL) since the
// recipient's mail client — never this server — fetches the logo image.
export function emailShell(title: string, subtitle: string | null, accent: EmailAccent, body: string, width = 480): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const color = ACCENT_COLOR[accent]
  const logo = appUrl
    ? `<img src="${appUrl}/shikho-logo.png" alt="Shikho" width="30" height="30" style="display:block;border:0;margin:0 auto 8px" />`
    : ''
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 0;background:${BRAND.surface};font-family:${FONT}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
    <table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:${width}px;max-width:100%">
      <tr><td align="center" style="padding-bottom:4px">
        ${logo}
      </td></tr>
      <tr><td style="background:${color};border-radius:16px 16px 0 0;padding:20px 32px">
        <div style="color:#fff;font-size:19px;font-weight:700;font-family:${FONT};line-height:1.3">${title}</div>
        ${subtitle ? `<div style="color:#fff;margin-top:4px;font-size:13px;font-weight:400;line-height:1.4">${subtitle}</div>` : ''}
      </td></tr>
      <tr><td style="background:#fff;border:1px solid ${BRAND.border};border-top:none;border-radius:0 0 16px 16px;padding:28px 32px;color:${BRAND.ink};font-size:14px;line-height:1.6">
        ${body}
      </td></tr>
      <tr><td style="padding:20px 4px 0;text-align:center;font-size:11px;color:${BRAND.footerMuted}">${PRODUCT_NAME} · Automated message — please do not reply</td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

function credentialsBody(intro: string, email: string, tempPassword: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  return `
    <p style="margin:0 0 16px">${intro}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.surface};border-radius:12px;padding:16px 20px;width:100%;margin-bottom:16px">
      <tr><td style="font-size:12px;color:${BRAND.muted};padding-bottom:2px">Email</td></tr>
      <tr><td style="font-size:14px;font-weight:600;padding-bottom:12px">${escapeHtml(email)}</td></tr>
      <tr><td style="font-size:12px;color:${BRAND.muted};padding-bottom:2px">Temporary password</td></tr>
      <tr><td style="font-size:18px;font-weight:700;letter-spacing:.04em;font-family:Consolas,Menlo,monospace;color:${BRAND.magenta}">${escapeHtml(tempPassword)}</td></tr>
    </table>
    <p style="margin:0 0 20px">You will be asked to choose your own password the first time you sign in.</p>
    ${appUrl ? `<a href="${escapeHtml(appUrl)}" style="display:inline-block;background:${BRAND.indigo};color:#fff;text-decoration:none;padding:11px 22px;border-radius:999px;font-weight:600">Sign in</a>` : ''}`
}

async function send(to: string, subject: string, html: string) {
  await getTransporter().sendMail({
    from: `"${process.env.EMAIL_FROM_NAME ?? 'Shikho QA'}" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
  })
}

export async function sendWelcomeEmail(name: string, email: string, tempPassword: string) {
  await send(
    email,
    subjectLine('Your account is ready'),
    emailShell(
      'Welcome to Shikho QA',
      'Your account is ready',
      'indigo',
      credentialsBody(`Hi ${escapeHtml(name)}, an account has been created for you.`, email, tempPassword)
    )
  )
}

export async function sendPasswordResetEmail(name: string, email: string, tempPassword: string) {
  await send(
    email,
    subjectLine('Your password was reset'),
    emailShell(
      'Password reset',
      'A new temporary password has been issued',
      'indigo',
      credentialsBody(`Hi ${escapeHtml(name)}, an administrator reset your password.`, email, tempPassword)
    )
  )
}

// ── Briefings (§5) ───────────────────────────────────────────
// The agent gets a dedicated email, their Team Leader CC'd — never the
// auditor, who sees their own schedule in-app instead (Part B).

function briefingTimeBody(intro: string, conductorName: string, scheduledAtIso: string): string {
  const label = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka',
  }).format(new Date(scheduledAtIso))
  return `
    <p style="margin:0 0 16px">${intro}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.surface};border-radius:12px;padding:16px 20px;width:100%;margin-bottom:16px">
      <tr><td style="font-size:12px;color:${BRAND.muted};padding-bottom:2px">With</td></tr>
      <tr><td style="font-size:16px;font-weight:700;padding-bottom:12px">${escapeHtml(conductorName)}</td></tr>
      <tr><td style="font-size:12px;color:${BRAND.muted};padding-bottom:2px">When</td></tr>
      <tr><td style="font-size:16px;font-weight:700">${escapeHtml(label)} (Dhaka time)</td></tr>
    </table>`
}

async function sendBriefingMail(
  subject: string,
  title: string,
  subtitle: string,
  accent: EmailAccent,
  body: string,
  agentEmail: string,
  teamLeaderEmail: string | null
) {
  const html = emailShell(title, subtitle, accent, body)
  await getTransporter().sendMail({
    from: `"${process.env.EMAIL_FROM_NAME ?? 'Shikho QA'}" <${process.env.EMAIL_FROM}>`,
    to: agentEmail,
    cc: teamLeaderEmail ?? undefined,
    subject,
    html,
  })
}

// conductorName = the QA staff member who will run the session (the
// briefing's own conducted_by), so the agent knows who to expect.
export async function sendBriefingScheduledEmail(agentName: string, agentEmail: string, teamLeaderEmail: string | null, scheduledAtIso: string, conductorName: string) {
  await sendBriefingMail(
    subjectLine(`Coaching session with ${conductorName} scheduled`),
    'Coaching session scheduled',
    `With ${escapeHtml(conductorName)}`,
    'indigo',
    briefingTimeBody(`Hi ${escapeHtml(agentName)}, you have a coaching session with <b>${escapeHtml(conductorName)}</b>.`, conductorName, scheduledAtIso),
    agentEmail,
    teamLeaderEmail
  )
}

export async function sendBriefingRescheduledEmail(agentName: string, agentEmail: string, teamLeaderEmail: string | null, scheduledAtIso: string, conductorName: string) {
  await sendBriefingMail(
    subjectLine(`Coaching session with ${conductorName} rescheduled`),
    'Coaching session rescheduled',
    `With ${escapeHtml(conductorName)} — new time`,
    'indigo',
    briefingTimeBody(`Hi ${escapeHtml(agentName)}, your coaching session with <b>${escapeHtml(conductorName)}</b> has a new time.`, conductorName, scheduledAtIso),
    agentEmail,
    teamLeaderEmail
  )
}

export async function sendBriefingCancelledEmail(agentName: string, agentEmail: string, teamLeaderEmail: string | null, conductorName: string) {
  await sendBriefingMail(
    subjectLine(`Coaching session with ${conductorName} cancelled`),
    'Coaching session cancelled',
    `With ${escapeHtml(conductorName)}`,
    'sunrise',
    `<p style="margin:0">Hi ${escapeHtml(agentName)}, your scheduled coaching session with <b>${escapeHtml(conductorName)}</b> has been cancelled. A new time may be booked later.</p>`,
    agentEmail,
    teamLeaderEmail
  )
}

// ── Briefings daily digest (§5, Part C) ──────────────────────
// One email to one Team Lead / Manager. The content is built (and scoped to
// that person's own people) by digest.ts / digest-email.ts; this only sends.
// Calibration results (§5, Stage 4): one email to one participant; the content is built by calibration/report-email.ts.
export async function sendCalibrationReportEmail(to: string, subject: string, html: string, text: string) {
  await getTransporter().sendMail({
    from: `"${process.env.EMAIL_FROM_NAME ?? 'Shikho QA'}" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
    text,
  })
}

export async function sendBriefingDigestEmail(to: string, subject: string, html: string, text: string) {
  await getTransporter().sendMail({
    from: `"${process.env.EMAIL_FROM_NAME ?? 'Shikho QA'}" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
    text,
  })
}

// Audit-submitted email (2026-10-02, Cc list extended 2026-10-03): one email per audit,
// To: the agent, Cc: their Team Leader always, plus the Manager and every QA Manager too
// when the audit didn't pass (scoring-actions.ts decides the Cc list; this just sends it).
export async function sendAuditEmail(to: string, cc: string | string[] | null, subject: string, html: string, text: string) {
  const ccValue = Array.isArray(cc) ? (cc.length ? cc : undefined) : (cc ?? undefined)
  await getTransporter().sendMail({
    from: `"${process.env.EMAIL_FROM_NAME ?? 'Shikho QA'}" <${process.env.EMAIL_FROM}>`,
    to,
    cc: ccValue,
    subject,
    html,
    text,
  })
}

// Campaign Mistake Report (2026-10-04) — ONE broadcast email, not one per recipient (unlike
// every other report/digest in this file): To: the site leadership group mailboxes, Cc: every
// real Manager/QA Manager/Super Admin. Jamil's own call — the report itself already scopes each
// viewer to their own agents when they're signed in, so the email doesn't need to be personalized.
export async function sendCampaignMistakeReportEmail(to: string[], cc: string[], subject: string, html: string, text: string) {
  await getTransporter().sendMail({
    from: `"${process.env.EMAIL_FROM_NAME ?? 'Shikho QA'}" <${process.env.EMAIL_FROM}>`,
    to,
    cc: cc.length ? cc : undefined,
    subject,
    html,
    text,
  })
}

// PIP publish notifications (§6.4, Section C, Stage 7): one email per published agent
// (their own period/target/achievement/downgrade note) and one per Team Lead/Manager
// (only their own people's names) — content built by pip/notification-email.ts.
export async function sendPipNotificationEmail(to: string, subject: string, html: string, text: string) {
  await getTransporter().sendMail({
    from: `"${process.env.EMAIL_FROM_NAME ?? 'Shikho QA'}" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
    text,
  })
}
