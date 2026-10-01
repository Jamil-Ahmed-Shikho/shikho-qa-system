'use server'
// ============================================================
// SHIKHO QA SYSTEM — save / submit a scorecard (§4 step 4)
//
// These take MARKS and the auditor's feedback text (which parameters passed,
// which error attributes were ticked and why, which fatals, the coaching
// summary and any per-parameter notes) — never a score. The database
// function write_audit_results derives every number from the marks and
// enforces the confirmed scoring rule, in one transaction, so a doctored
// request can't submit a score of its own.
//
// Returns { ok, error } objects, not thrown errors (Next.js hides thrown
// messages in production — CLAUDE.md §14).
// ============================================================

import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseAdmin, getSupabaseServer } from '@/lib/supabase/server'
import { writeAuditLogs } from '@/lib/users/audit-log'
import { sendAuditEmail } from '@/lib/users/mailer'
import type { AuthUser } from '@/types/database.types'
import { parsePayload, type MarksPayload } from './scoring'
import { loadAuditEmailData, loadQaManagers, qualifiesForRedFatalAlert } from './audit-notifications'
import { auditResultHtml, auditResultSubject, auditResultText, redFatalAlertHtml, redFatalAlertSubject, redFatalAlertText } from './audit-email-templates'
import { parseNotifyMode, parseNotifyTestRecipients, runNotifySend, type NotifyTarget } from '@/lib/pip/notification-runner'
import { createNotifications } from '@/lib/notifications/notifications.service'

export interface SubmitResult {
  score_percent: number
  passed: boolean
  critical_fail: boolean
  pass_mark: number
  points_earned: number
  points_possible: number
}

type Failure = { ok: false; error: string }

type Prepared =
  | { error: string }
  | { user: AuthUser; audit: { id: string; crm_lead_id: string | null }; payload: MarksPayload }

async function prepare(auditId: string, rawPayload: unknown): Promise<Prepared> {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager', 'qa_auditor', 'team_lead'].includes(user.role)) {
    return { error: 'Only QA roles can score an audit.' }
  }

  const parsed = parsePayload(rawPayload)
  if (!parsed.ok) return { error: parsed.error }

  // Loaded as the signed-in user, so row-level security decides they may
  // see this audit at all; then it must be THEIR draft.
  const supabase = await getSupabaseServer()
  const { data: audit } = await supabase
    .from('audits')
    .select('id, auditor_id, status, crm_lead_id')
    .eq('id', auditId)
    .maybeSingle()
  if (!audit) return { error: 'Audit not found.' }
  if (audit.auditor_id !== user.profile.id) return { error: 'Only the auditor who started this audit can score it.' }
  if (audit.status !== 'draft') return { error: 'This audit has already been submitted and can no longer be changed.' }

  return { user, audit: { id: audit.id, crm_lead_id: audit.crm_lead_id }, payload: parsed.payload }
}

// The function's own rules ("Not every parameter has been scored…") are
// raised as ordinary exceptions and are written for the auditor to read;
// anything else (a connection problem…) is not.
function friendly(error: { code?: string; message: string }): string {
  if (error.code === 'P0001') return error.message
  console.error('write_audit_results failed:', error.code, error.message)
  return 'Something went wrong saving the scorecard. Please try again.'
}

async function write(auditId: string, actorId: string, finalize: boolean, p: MarksPayload) {
  return getSupabaseAdmin().rpc('write_audit_results', {
    p_audit_id: auditId,
    p_actor: actorId,
    p_finalize: finalize,
    p_results: p.results,
    p_ticks: p.ticks,
    p_fatals: p.fatals,
    p_overall_feedback: p.overall_feedback,
    // null (an older page) = leave the stored campaign links alone; otherwise the full new state
    p_campaigns: p.campaigns,
  })
}

/** Save the scorecard as it stands (partial is fine) — the audit stays a draft. */
export async function saveScorecardDraft(auditId: string, rawPayload: unknown): Promise<{ ok: true } | Failure> {
  const ctx = await prepare(auditId, rawPayload)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { user, audit, payload } = ctx

  const { error } = await write(audit.id, user.profile.id, false, payload)
  if (error) return { ok: false, error: friendly(error) }

  revalidatePath(`/audits/${audit.id}`)
  return { ok: true }
}

/** Score it and submit: draft -> submitted, once, atomically. */
export async function submitScorecard(auditId: string, rawPayload: unknown): Promise<{ ok: true; result: SubmitResult } | Failure> {
  const ctx = await prepare(auditId, rawPayload)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { user, audit, payload } = ctx

  const { data, error } = await write(audit.id, user.profile.id, true, payload)
  if (error) return { ok: false, error: friendly(error) }
  const result = data as SubmitResult

  await writeAuditLogs([{
    actor_id: user.profile.id,
    action: 'audit.submitted',
    table_name: 'audits',
    record_id: audit.id,
    after_data: {
      score_percent: result.score_percent,
      passed: result.passed,
      critical_fail: result.critical_fail,
      pass_mark_used: result.pass_mark,
      fatal_errors_ticked: payload.fatals.length,
      parameters_failed: payload.results.filter((r) => !r.passed).length,
      special_check_campaigns: payload.campaigns?.length ?? 0,
    },
  }])

  revalidatePath(`/audits/${audit.id}`)
  if (audit.crm_lead_id) revalidatePath(`/audits/leads/${audit.crm_lead_id}`)

  sendAuditEmailsAfterResponse(audit.id, user.profile.id)
  return { ok: true, result }
}

// Sent AFTER the response (next/server `after`), same reasoning as the Briefings scheduling
// emails (§5 Part A): the audit is already saved, and waiting on SMTP made the submit screen
// feel stuck. A failure can no longer be told to the caller, so it's written to audit_log
// (`audit.email_failed`) and server logs instead of silently vanishing.
//
// SAFE BY DEFAULT — AUDIT_EMAIL_MODE (same shape as PIP_NOTIFICATIONS_MODE/BRIEFING_DIGEST_MODE):
//   off (default)  nothing is sent
//   test           sends ONLY to recipients in AUDIT_EMAIL_TEST_RECIPIENTS
//   live           sends to every real recipient — the agent (cc their Team Leader), and, for a
//                  Red or critical-fatal audit only, their Manager and every QA Manager
function sendAuditEmailsAfterResponse(auditId: string, actorId: string) {
  after(async () => {
    try {
      const d = await loadAuditEmailData(auditId)
      if (!d) return
      const isRedFatal = qualifiesForRedFatalAlert(d)
      const qaManagers = isRedFatal ? await loadQaManagers() : []

      // In-app notifications (schema_064) — always created, unlike the email below, since there's
      // no inbox-spam risk to gate: only the recipient themselves ever sees their own row (RLS).
      const outcome = d.criticalFail ? 'a critical fatal' : d.passed ? `${d.scorePercent}%, Passed` : `${d.scorePercent}%, Failed`
      await createNotifications([
        {
          recipientId: d.agentId,
          type: 'audit_submitted',
          title: 'Your audit result is in',
          body: `${d.auditorName} scored your ${new Date(d.submittedAt).toLocaleDateString('en-GB')} call — ${outcome}.`,
          link: `/my-audits/${auditId}`,
          relatedTable: 'audits',
          relatedId: auditId,
        },
        ...(isRedFatal
          ? [...(d.managerId ? [d.managerId] : []), ...qaManagers.map((m) => m.id)]
              .filter((id, i, arr) => arr.indexOf(id) === i)
              .map((recipientId) => ({
                recipientId,
                type: 'audit_red_fatal' as const,
                title: `${d.agentName}'s audit needs attention`,
                body: d.criticalFail
                  ? `Critical fatal error — ${d.agentName}, scored by ${d.auditorName}.`
                  : `Scored ${d.scorePercent}% (below the ${d.passMarkUsed}% pass mark) — ${d.agentName}, scored by ${d.auditorName}.`,
                link: `/audits/${auditId}`,
                relatedTable: 'audits',
                relatedId: auditId,
              }))
          : []),
      ])

      const targets: NotifyTarget[] = []
      if (d.agentEmail) {
        targets.push({
          email: d.agentEmail,
          send: () => sendAuditEmail(d.agentEmail as string, d.teamLeaderEmail, auditResultSubject(d), auditResultHtml(d), auditResultText(d)),
        })
      }
      if (isRedFatal) {
        const recipients = new Map<string, string>() // email -> name, deduped (a BPO Team Lead's "manager" can itself be a qa_manager)
        if (d.managerEmail && d.managerName) recipients.set(d.managerEmail, d.managerName)
        for (const m of qaManagers) recipients.set(m.email, m.name)
        for (const [email, name] of recipients) {
          targets.push({ email, send: () => sendAuditEmail(email, null, redFatalAlertSubject(d), redFatalAlertHtml(name, d), redFatalAlertText(name, d)) })
        }
      }

      const mode = parseNotifyMode(process.env.AUDIT_EMAIL_MODE)
      const result = await runNotifySend(mode, parseNotifyTestRecipients(process.env.AUDIT_EMAIL_TEST_RECIPIENTS), targets)
      if (result.failed.length) {
        await writeAuditLogs([{
          actor_id: actorId,
          action: 'audit.email_failed',
          table_name: 'audits',
          record_id: auditId,
          after_data: { mode, failed: result.failed },
        }])
      }
    } catch (err) {
      console.error('Audit-submitted email failed:', err)
      await writeAuditLogs([{
        actor_id: actorId,
        action: 'audit.email_failed',
        table_name: 'audits',
        record_id: auditId,
        after_data: { error: err instanceof Error ? err.message : String(err) },
      }])
    }
  })
}
