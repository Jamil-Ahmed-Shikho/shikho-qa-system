'use server'
// ============================================================
// SHIKHO QA SYSTEM — Briefings server actions (§5, Part A)
// Return { ok, error } objects instead of throwing (§14 lesson) — every
// service call here is wrapped, since requireScheduler() (and the
// "audit not found" / "not submitted" checks) throw.
//
// The notification email is sent AFTER the response (next/server `after`):
// the booking is already saved, and waiting on SMTP (seconds) made the
// screen feel stuck. The trade-off is that the caller can no longer be told
// "the email failed" — so a failure is written to audit_log
// (`briefing.email_failed`) and server logs instead of vanishing.
// ============================================================

import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { writeAuditLogs } from '@/lib/users/audit-log'
import {
  sendBriefingCancelledEmail,
  sendBriefingRescheduledEmail,
  sendBriefingScheduledEmail,
} from '@/lib/users/mailer'
import {
  cancelBriefing,
  loadSchedulerData,
  markAttendance,
  rescheduleBriefing,
  scheduleBriefing,
  type Result,
} from './briefings.service'
import type { AuthUser } from '@/types/database.types'

type Fail = { ok: false; error: string }

async function guard(): Promise<{ actor: AuthUser } | { error: string }> {
  try {
    const user = await getAuthUser()
    if (!user) throw new Error('Not signed in.')
    return { actor: user }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Not signed in.' }
  }
}

/** Wraps a service call that may THROW (requireScheduler(), "not found", etc.) into a Result. */
async function attempt<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' }
  }
}

/** Send the email once the response has gone out; record a failure instead of losing it. */
function sendAfterResponse(actorId: string, auditId: string, kind: string, send: () => Promise<void>) {
  after(async () => {
    try {
      await send()
    } catch (err) {
      console.error(`Briefing ${kind} email failed:`, err)
      await writeAuditLogs([{
        actor_id: actorId,
        action: 'briefing.email_failed',
        table_name: 'briefings',
        record_id: auditId,
        after_data: { kind, error: err instanceof Error ? err.message : String(err) },
      }])
    }
  })
}

export async function loadSchedulerDataAction(
  auditId: string
): Promise<{ ok: true; data: Awaited<ReturnType<typeof loadSchedulerData>> } | Fail> {
  try {
    const data = await loadSchedulerData(auditId)
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not load scheduling data.' }
  }
}

export async function scheduleBriefingAction(auditId: string, scheduledAtIso: string): Promise<{ ok: true } | Fail> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }

  const result = await attempt(() => scheduleBriefing(auditId, scheduledAtIso))
  if (!result.ok) return result

  await writeAuditLogs([{
    actor_id: g.actor.profile.id,
    action: 'briefing.scheduled',
    table_name: 'briefings',
    record_id: auditId,
    after_data: { scheduled_at: scheduledAtIso },
  }])

  sendAfterResponse(g.actor.profile.id, auditId, 'scheduled', () =>
    sendBriefingScheduledEmail(result.agentName, result.agentEmail, result.teamLeaderEmail, scheduledAtIso, result.conductorName)
  )

  revalidatePath('/audits')
  return { ok: true }
}

export async function rescheduleBriefingAction(auditId: string, scheduledAtIso: string): Promise<{ ok: true } | Fail> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }

  const result = await attempt(() => rescheduleBriefing(auditId, scheduledAtIso))
  if (!result.ok) return result

  await writeAuditLogs([{
    actor_id: g.actor.profile.id,
    action: 'briefing.rescheduled',
    table_name: 'briefings',
    record_id: auditId,
    after_data: { scheduled_at: scheduledAtIso },
  }])

  sendAfterResponse(g.actor.profile.id, auditId, 'rescheduled', () =>
    sendBriefingRescheduledEmail(result.agentName, result.agentEmail, result.teamLeaderEmail, scheduledAtIso, result.conductorName)
  )

  revalidatePath('/audits')
  return { ok: true }
}

export async function cancelBriefingAction(auditId: string): Promise<{ ok: true } | Fail> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }

  const result = await attempt(() => cancelBriefing(auditId))
  if (!result.ok) return result

  await writeAuditLogs([{
    actor_id: g.actor.profile.id,
    action: 'briefing.cancelled',
    table_name: 'briefings',
    record_id: auditId,
  }])

  if (result.agentEmail) {
    sendAfterResponse(g.actor.profile.id, auditId, 'cancelled', () =>
      sendBriefingCancelledEmail(result.agentName, result.agentEmail, result.teamLeaderEmail, result.conductorName)
    )
  }

  revalidatePath('/audits')
  return { ok: true }
}

export async function markAttendanceAction(auditId: string, attended: boolean): Promise<{ ok: true } | Fail> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }

  const result = await attempt(() => markAttendance(auditId, attended))
  if (!result.ok) return result

  await writeAuditLogs([{
    actor_id: g.actor.profile.id,
    action: attended ? 'briefing.attended' : 'briefing.no_show',
    table_name: 'briefings',
    record_id: auditId,
  }])

  revalidatePath('/audits')
  return { ok: true }
}
