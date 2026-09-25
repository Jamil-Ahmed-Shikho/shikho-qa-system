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

const INDIGO = '#304090'
const FONT = `'Poppins','Hind Siliguri',Arial,sans-serif`

export function emailShell(title: string, body: string, width = 480): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 0;background:#F4F5FA;font-family:${FONT}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
    <table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:${width}px;max-width:100%">
      <tr><td style="background:${INDIGO};padding:24px 32px;border-radius:16px 16px 0 0">
        <h1 style="color:#fff;margin:0;font-size:19px;font-weight:600;font-family:${FONT}">${title}</h1>
      </td></tr>
      <tr><td style="background:#fff;border:1px solid #DFE1EA;border-top:none;border-radius:0 0 16px 16px;padding:28px 32px;color:#0F1322;font-size:14px;line-height:1.6">
        ${body}
      </td></tr>
      <tr><td style="padding:20px 4px 0;text-align:center;font-size:11px;color:#898EA4">Shikho QA Audit Management System · Automated message</td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

function credentialsBody(intro: string, email: string, tempPassword: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  return `
    <p style="margin:0 0 16px">${intro}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:#F4F5FA;border-radius:12px;padding:16px 20px;width:100%;margin-bottom:16px">
      <tr><td style="font-size:12px;color:#5A5F76;padding-bottom:2px">Email</td></tr>
      <tr><td style="font-size:14px;font-weight:600;padding-bottom:12px">${escapeHtml(email)}</td></tr>
      <tr><td style="font-size:12px;color:#5A5F76;padding-bottom:2px">Temporary password</td></tr>
      <tr><td style="font-size:16px;font-weight:700;letter-spacing:.04em;font-family:Consolas,Menlo,monospace">${escapeHtml(tempPassword)}</td></tr>
    </table>
    <p style="margin:0 0 20px">You will be asked to choose your own password the first time you sign in.</p>
    ${appUrl ? `<a href="${escapeHtml(appUrl)}" style="display:inline-block;background:${INDIGO};color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600">Sign in</a>` : ''}`
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
    'Your Shikho QA Audit System account is ready',
    emailShell(
      'Welcome to Shikho QA',
      credentialsBody(`Hi ${escapeHtml(name)}, an account has been created for you.`, email, tempPassword)
    )
  )
}

export async function sendPasswordResetEmail(name: string, email: string, tempPassword: string) {
  await send(
    email,
    'Your Shikho QA Audit System password was reset',
    emailShell(
      'Password reset',
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
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:#F4F5FA;border-radius:12px;padding:16px 20px;width:100%;margin-bottom:16px">
      <tr><td style="font-size:12px;color:#5A5F76;padding-bottom:2px">With</td></tr>
      <tr><td style="font-size:16px;font-weight:700;padding-bottom:12px">${escapeHtml(conductorName)}</td></tr>
      <tr><td style="font-size:12px;color:#5A5F76;padding-bottom:2px">When</td></tr>
      <tr><td style="font-size:16px;font-weight:700">${escapeHtml(label)} (Dhaka time)</td></tr>
    </table>`
}

async function sendBriefingMail(
  subject: string,
  title: string,
  body: string,
  agentEmail: string,
  teamLeaderEmail: string | null
) {
  const html = emailShell(title, body)
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
    `Your coaching session with ${conductorName} is scheduled`,
    'Coaching session scheduled',
    briefingTimeBody(`Hi ${escapeHtml(agentName)}, you have a coaching session with <b>${escapeHtml(conductorName)}</b>.`, conductorName, scheduledAtIso),
    agentEmail,
    teamLeaderEmail
  )
}

export async function sendBriefingRescheduledEmail(agentName: string, agentEmail: string, teamLeaderEmail: string | null, scheduledAtIso: string, conductorName: string) {
  await sendBriefingMail(
    `Your coaching session with ${conductorName} was rescheduled`,
    'Coaching session rescheduled',
    briefingTimeBody(`Hi ${escapeHtml(agentName)}, your coaching session with <b>${escapeHtml(conductorName)}</b> has a new time.`, conductorName, scheduledAtIso),
    agentEmail,
    teamLeaderEmail
  )
}

export async function sendBriefingCancelledEmail(agentName: string, agentEmail: string, teamLeaderEmail: string | null, conductorName: string) {
  await sendBriefingMail(
    `Your coaching session with ${conductorName} was cancelled`,
    'Coaching session cancelled',
    `<p style="margin:0">Hi ${escapeHtml(agentName)}, your scheduled coaching session with <b>${escapeHtml(conductorName)}</b> has been cancelled. A new time may be booked later.</p>`,
    agentEmail,
    teamLeaderEmail
  )
}

// ── Briefings daily digest (§5, Part C) ──────────────────────
// One email to one Team Lead / Manager. The content is built (and scoped to
// that person's own people) by digest.ts / digest-email.ts; this only sends.
export async function sendBriefingDigestEmail(to: string, subject: string, html: string, text: string) {
  await getTransporter().sendMail({
    from: `"${process.env.EMAIL_FROM_NAME ?? 'Shikho QA'}" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
    text,
  })
}
