// ============================================================
// Send ONE sample of every email template this system can produce, to a
// single real inbox, for review — on Jamil's explicit request ("I want to
// see all the sample emails we will send to users, managers, TLs, can you
// send a test email to my email as a test?").
//
// Every send here uses FIXTURE data (obviously-fake names like "Example
// Agent") rendered through the REAL template functions and the REAL SMTP
// path — it does not touch the database, schedule a real briefing, publish
// a real PIP cycle, or create a real calibration session. Every subject is
// prefixed "[SAMPLE]" so it's unmistakable in the inbox (same convention as
// Calibration's own "[TEST]" prefix).
//
// NEXT_PUBLIC_APP_URL is forced to the production URL before any template
// renders — running from local dev, .env.local's own value is
// http://localhost:3000, which is exactly the "corrupted logo / dead link"
// bug CLAUDE.md already documents and fixed once (the logo image and CTA
// links are built from this var, fetched by the recipient's mail client,
// not reachable from their machine if left as localhost).
//
//   npx tsx --env-file=.env.local scripts/send-sample-emails.mts <recipient-email>
// ============================================================
process.env.NEXT_PUBLIC_APP_URL = 'https://shikho-qa-system.vercel.app'

import nodemailer from 'nodemailer'
import { BRAND, emailShell, escapeHtml, subjectLine } from '@/lib/users/mailer'
import { auditResultHtml, auditResultText, redFatalAlertHtml, redFatalAlertText } from '@/lib/audits/audit-email-templates'
import type { AuditEmailData } from '@/lib/audits/audit-notifications'
import { digestHtml, digestText } from '@/lib/briefings/digest-email'
import type { Digest } from '@/lib/briefings/digest'
import { reportHtml, reportText } from '@/lib/calibration/report-email'
import type { VarianceReport } from '@/lib/calibration/variance'
import { agentNotificationHtml, agentNotificationText, staffNotificationHtml, staffNotificationText } from '@/lib/pip/notification-email'
import type { AgentNotification, StaffNotification } from '@/lib/pip/notifications'

const TO = process.argv[2]
if (!TO || !TO.includes('@')) {
  console.error('Usage: npx tsx --env-file=.env.local scripts/send-sample-emails.mts <recipient-email>')
  process.exit(1)
}

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: process.env.GMAIL_SMTP_USER, pass: process.env.GMAIL_SMTP_APP_PASSWORD },
})

async function send(label: string, subject: string, html: string, text?: string) {
  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME ?? 'Shikho QA'}" <${process.env.EMAIL_FROM}>`,
    to: TO,
    subject: `[SAMPLE] ${subject}`,
    html,
    text,
  })
  console.log(`  sent: ${label}`)
}

// ── Account / password ──────────────────────────────────────────────────
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

// ── Fixtures ─────────────────────────────────────────────────────────────
const now = new Date()
const iso = (daysOffset: number, hour: number, min = 0) => {
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() + daysOffset)
  d.setUTCHours(hour - 6, min, 0, 0) // crude Dhaka (+6) -> UTC
  return d.toISOString()
}

const baseAuditData: Omit<AuditEmailData, 'scorePercent' | 'passed' | 'criticalFail' | 'overallFeedback' | 'parameters' | 'fatals'> = {
  auditId: '00000000-0000-0000-0000-000000000001',
  agentId: '00000000-0000-0000-0000-00000000000a',
  agentName: 'Example Agent',
  agentEmail: 'example.agent@shikho.com',
  agentEmpId: 'JAC0000',
  agentTeamName: 'Telesales',
  agentVintageLabel: '3-6 Months',
  teamLeaderId: '00000000-0000-0000-0000-00000000000b',
  teamLeaderName: 'Example Team Leader',
  teamLeaderEmail: 'example.tl@shikho.com',
  managerId: '00000000-0000-0000-0000-00000000000c',
  managerName: 'Example Manager',
  managerEmail: 'example.manager@shikho.com',
  auditorName: 'Example QA Auditor',
  rubricName: 'Telesales Scorecard',
  callStartedAt: iso(-1, 14, 20),
  callEndedAt: iso(-1, 14, 27),
  callDestination: '1XXXXXXXXX',
  crmLeadId: '1234567',
  distributionList: 'C10 S27 - SCI - New Pitch - Sep',
  contactStage: 'Qualified',
  submittedAt: iso(0, 10, 0),
  passMarkUsed: 70,
}

const paramsPassing = [
  { name: 'Call Opening', categoryName: 'Opening', points: 2, pointsAwarded: 2, passed: true, feedback: null },
  { name: 'Rapport Building', categoryName: 'Opening', points: 7, pointsAwarded: 7, passed: true, feedback: null },
  { name: 'Features & Benefits', categoryName: 'Pitch', points: 12, pointsAwarded: 12, passed: true, feedback: null },
  { name: 'Price Demonstration', categoryName: 'Pitch', points: 8, pointsAwarded: 8, passed: true, feedback: null },
  { name: 'Handling Objection & Overcome the barriers', categoryName: 'Pitch', points: 10, pointsAwarded: 10, passed: true, feedback: null },
]
const paramsWithFailures = [
  { name: 'Call Opening', categoryName: 'Opening', points: 2, pointsAwarded: 2, passed: true, feedback: null },
  { name: 'Features & Benefits', categoryName: 'Pitch', points: 12, pointsAwarded: 0, passed: false, feedback: 'Did not clearly explain the course structure or weekly class routine.' },
  { name: 'Sales Closing (Conv. Summarization & Ask for sale)', categoryName: 'Closing', points: 10, pointsAwarded: 0, passed: false, feedback: 'Did not summarize the call or ask directly for the sale.' },
  { name: 'CRM Task & Follow-Up Accuracy', categoryName: 'Documentation', points: 5, pointsAwarded: 0, passed: false, feedback: 'No follow-up task created in CRM after the call.' },
]

async function main() {
  console.log(`Sending sample emails to ${TO} ...\n`)

  // 1. Welcome
  await send(
    'Account welcome',
    subjectLine('Your account is ready'),
    emailShell('Welcome to Shikho QA', 'Your account is ready', 'indigo',
      credentialsBody('Hi Example User, an account has been created for you.', TO, 'Sample#TempPass123')),
  )

  // 2. Password reset
  await send(
    'Password reset',
    subjectLine('Your password was reset'),
    emailShell('Password reset', 'A new temporary password has been issued', 'indigo',
      credentialsBody('Hi Example User, an administrator reset your password.', TO, 'Sample#NewPass456')),
  )

  // 3-5. Briefings scheduled / rescheduled / cancelled
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
  await send('Briefing scheduled', subjectLine('Coaching session with Example Auditor scheduled'),
    emailShell('Coaching session scheduled', 'With Example Auditor', 'indigo',
      briefingTimeBody('Hi Example Agent, you have a coaching session with <b>Example Auditor</b>.', 'Example Auditor', iso(2, 12, 0))))
  await send('Briefing rescheduled', subjectLine('Coaching session with Example Auditor rescheduled'),
    emailShell('Coaching session rescheduled', 'With Example Auditor — new time', 'indigo',
      briefingTimeBody('Hi Example Agent, your coaching session with <b>Example Auditor</b> has a new time.', 'Example Auditor', iso(3, 13, 30))))
  await send('Briefing cancelled', subjectLine('Coaching session with Example Auditor cancelled'),
    emailShell('Coaching session cancelled', 'With Example Auditor', 'sunrise',
      `<p style="margin:0">Hi Example Agent, your scheduled coaching session with <b>Example Auditor</b> has been cancelled. A new time may be booked later.</p>`))

  // 6. Briefings daily digest (Team Lead)
  const digest: Digest = {
    recipient: { id: 'x', name: 'Example Team Leader', email: TO, role: 'team_lead' },
    ymd: '2026-10-05',
    dayLabel: 'Mon 5 Oct',
    total: 2,
    groups: [{
      label: null,
      rows: [
        { briefingId: 'b1', agentName: 'Example Agent One', time: '11:15 AM', scheduledAt: iso(1, 11, 15), conductorName: 'Example Auditor', urgent: true },
        { briefingId: 'b2', agentName: 'Example Agent Two', time: '2:00 PM', scheduledAt: iso(1, 14, 0), conductorName: 'Example Auditor', urgent: false },
      ],
    }],
  }
  await send('Briefing daily digest', digestSubjectSample(digest), digestHtml(digest), digestText(digest))
  function digestSubjectSample(d: Digest) {
    return subjectLine(`Coaching sessions tomorrow (${d.dayLabel}): ${d.total} of your agents`)
  }

  // 7. Calibration report
  const variance: VarianceReport = {
    count: 3, mean: 82.7, min: 74, max: 90, range: 16, stdDev: 6.65,
    participants: [
      { userId: 'p1', name: 'Example Auditor A', role: 'qa_auditor', scorePercent: 90, criticalFail: false, deviation: 7.3, position: 'highest', notes: null },
      { userId: 'p2', name: 'Example Auditor B', role: 'qa_auditor', scorePercent: 84, criticalFail: false, deviation: 1.3, position: 'middle', notes: null },
      { userId: 'p3', name: 'Example Auditor C', role: 'qa_manager', scorePercent: 74, criticalFail: false, deviation: -8.7, position: 'lowest', notes: 'Marked Price Demonstration as a fail.' },
    ],
    splitParameters: [
      { parameterId: 'pr1', name: 'Price Demonstration', category: 'Pitch', points: 8, passed: ['Example Auditor A', 'Example Auditor B'], failed: ['Example Auditor C'], unanimous: false },
    ],
    allParameters: [],
    fatals: [],
  }
  await send('Calibration report', reportSubjectSample(), reportHtml({
    title: 'Weekly Telesales Calibration', whenLabel: 'Mon 5 Oct, 11:00 AM', scope: 'Telesales · Dhaka',
    rubricName: 'Telesales Scorecard', report: variance, notSubmitted: ['Example Auditor D'],
    url: `${process.env.NEXT_PUBLIC_APP_URL}/calibration/sample`,
  }), reportText({
    title: 'Weekly Telesales Calibration', whenLabel: 'Mon 5 Oct, 11:00 AM', scope: 'Telesales · Dhaka',
    rubricName: 'Telesales Scorecard', report: variance, notSubmitted: ['Example Auditor D'],
    url: `${process.env.NEXT_PUBLIC_APP_URL}/calibration/sample`,
  }))
  function reportSubjectSample() { return subjectLine('Calibration report: Weekly Telesales Calibration (Mon 5 Oct, 11:00 AM)') }

  // 8-10. Audit result — passed / failed / critical fatal
  const passedAudit: AuditEmailData = { ...baseAuditData, scorePercent: 92, passed: true, criticalFail: false, overallFeedback: 'Strong call overall — confident pitch and good objection handling.', parameters: paramsPassing, fatals: [] }
  await send('Audit result — passed', auditSubject(passedAudit), auditResultHtml(passedAudit), auditResultText(passedAudit))

  const failedAudit: AuditEmailData = { ...baseAuditData, scorePercent: 58, passed: false, criticalFail: false, overallFeedback: 'Several core pitch and closing steps were missed — needs coaching on sales closing.', parameters: paramsWithFailures, fatals: [] }
  await send('Audit result — failed', auditSubject(failedAudit), auditResultHtml(failedAudit), auditResultText(failedAudit))

  const criticalAudit: AuditEmailData = {
    ...baseAuditData, scorePercent: 0, passed: false, criticalFail: true,
    overallFeedback: 'Call auto-zeroed due to a critical compliance issue — see the fatal error below.',
    parameters: paramsWithFailures,
    fatals: [{ description: 'Made a false commitment about a guaranteed outcome not covered by the course', severity: 'critical', feedback: 'Told the student "you will definitely get an A+" — not a claim we can make.' }],
  }
  await send('Audit result — critical fatal', auditSubject(criticalAudit), auditResultHtml(criticalAudit), auditResultText(criticalAudit))
  function auditSubject(d: AuditEmailData) {
    const label = d.criticalFail ? 'Critical fatal error' : d.passed ? 'Passed' : 'Did not pass'
    return subjectLine(`Your audit result: ${d.scorePercent}% — ${label}`)
  }

  // 11-12. Manager / QA Manager alert — red (non-critical) / critical fatal
  await send('Manager alert — red (below pass mark)', redFatalAlertSubjectSample(failedAudit),
    redFatalAlertHtml('Example Manager', failedAudit), redFatalAlertText('Example Manager', failedAudit))
  await send('Manager alert — critical fatal', redFatalAlertSubjectSample(criticalAudit),
    redFatalAlertHtml('Example Manager', criticalAudit), redFatalAlertText('Example Manager', criticalAudit))
  function redFatalAlertSubjectSample(d: AuditEmailData) {
    return d.criticalFail
      ? subjectLine(`Critical fatal error — ${d.agentName}'s audit (${d.scorePercent}%)`)
      : subjectLine(`Red audit alert — ${d.agentName} scored ${d.scorePercent}%`)
  }

  // 13. PIP — agent notification
  const agentNotif: AgentNotification = {
    recipient: { id: 'a1', name: 'Example Agent', email: TO },
    targetRevenue: 300, incentiveDowngraded: true,
  }
  await send('PIP — agent placed', agentNotificationSubjectSample(),
    agentNotificationHtml({ n: agentNotif, achievementUsd: 142.5, label: '12 Oct 2026 – 1 Nov 2026' }),
    agentNotificationText({ n: agentNotif, achievementUsd: 142.5, label: '12 Oct 2026 – 1 Nov 2026' }))
  function agentNotificationSubjectSample() { return subjectLine('You have been placed on a Performance Improvement Plan (PIP)') }

  // 14. PIP — staff (Team Lead / Manager) summary
  const staffNotif: StaffNotification = {
    recipient: { id: 's1', name: 'Example Team Leader', email: TO, role: 'team_lead' },
    groups: [{ teamLeadName: null, agentNames: ['Example Agent One', 'Example Agent Two'] }],
    total: 2,
  }
  await send('PIP — staff summary', staffNotificationSubjectSample(staffNotif),
    staffNotificationHtml({ n: staffNotif, label: '12 Oct 2026 – 1 Nov 2026' }),
    staffNotificationText({ n: staffNotif, label: '12 Oct 2026 – 1 Nov 2026' }))
  function staffNotificationSubjectSample(n: StaffNotification) {
    return subjectLine(`PIP list published — ${n.total} of your ${n.total === 1 ? 'people is' : 'people are'} on it`)
  }

  console.log('\nAll sample emails sent.')
}

main().catch((err) => { console.error(err); process.exit(1) })
