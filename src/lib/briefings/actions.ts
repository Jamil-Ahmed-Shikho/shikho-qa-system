'use server'
// ============================================================
// SHIKHO QA SYSTEM — Briefings server actions (§5, Part A)
// Return { ok, error } objects instead of throwing (§14 lesson) — every
// service call here is wrapped, since requireScheduler() (and the
// "audit not found" / "not submitted" checks) throw.
// ============================================================

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

export async function scheduleBriefingAction(auditId: string, scheduledAtIso: string): Promise<{ ok: true; emailSent: boolean } | Fail> {
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

  let emailSent = true
  try {
    await sendBriefingScheduledEmail(result.agentName, result.agentEmail, result.teamLeaderEmail, scheduledAtIso)
  } catch (err) {
    emailSent = false
    console.error('Briefing scheduled email failed:', err)
  }

  revalidatePath('/audits')
  return { ok: true, emailSent }
}

export async function rescheduleBriefingAction(auditId: string, scheduledAtIso: string): Promise<{ ok: true; emailSent: boolean } | Fail> {
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

  let emailSent = true
  try {
    await sendBriefingRescheduledEmail(result.agentName, result.agentEmail, result.teamLeaderEmail, scheduledAtIso)
  } catch (err) {
    emailSent = false
    console.error('Briefing rescheduled email failed:', err)
  }

  revalidatePath('/audits')
  return { ok: true, emailSent }
}

export async function cancelBriefingAction(auditId: string): Promise<{ ok: true; emailSent: boolean } | Fail> {
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

  let emailSent = true
  if (result.agentEmail) {
    try {
      await sendBriefingCancelledEmail(result.agentName, result.agentEmail, result.teamLeaderEmail)
    } catch (err) {
      emailSent = false
      console.error('Briefing cancelled email failed:', err)
    }
  }

  revalidatePath('/audits')
  return { ok: true, emailSent }
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
