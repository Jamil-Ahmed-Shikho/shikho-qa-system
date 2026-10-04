// ============================================================
// SHIKHO QA SYSTEM — Sample Check payload (Phase 3, §4/§5)
// Pure module — safe for client and server. Mirrors scoring.ts's own
// campaigns-payload shape exactly (SpecialPayload), since a Sample Check
// is QA's existing Campaign/Special-Check mechanism with no rubric
// attached — never a parallel definition of the same thing.
// ============================================================

import { normalizeFeedback, FEEDBACK_LIMITS, type SpecialPayload } from './scoring'
import type { SpecialCampaign } from '@/lib/campaigns/special'

export interface SampleCheckMarks {
  /** campaign id -> (check id -> chosen option id) — same shape as a scorecard's marks.campaigns. */
  campaigns: Record<string, Record<string, string>>
  overallFeedback: string
}

export interface SampleCheckPayload {
  overall_feedback: string
  campaigns: SpecialPayload[]
}

export function emptySampleCheckMarks(): SampleCheckMarks {
  return { campaigns: {}, overallFeedback: '' }
}

export function marksFromSampleCheckPayload(payload: SampleCheckPayload): SampleCheckMarks {
  const campaigns: SampleCheckMarks['campaigns'] = {}
  for (const c of payload.campaigns) {
    campaigns[c.campaign_id] = Object.fromEntries(c.answers.map((a) => [a.check_type_id, a.value_id]))
  }
  return { campaigns, overallFeedback: payload.overall_feedback ?? '' }
}

/** Same ordering discipline as scoring.ts's campaignsPayload — stable order so the
 *  unsaved-changes comparison never false-flags on database row order alone. */
export function toSampleCheckPayload(marks: SampleCheckMarks, special: SpecialCampaign[]): SampleCheckPayload {
  const attached = marks.campaigns
  const ids = special.filter((d) => d.id in attached).map((d) => d.id)
  const campaigns: SpecialPayload[] = ids.map((id) => {
    const chosen = attached[id] ?? {}
    const def = special.find((d) => d.id === id)
    const checkIds = def ? def.checks.map((c) => c.id) : Object.keys(chosen)
    return {
      campaign_id: id,
      answers: checkIds.filter((c) => chosen[c]).map((c) => ({ check_type_id: c, value_id: chosen[c] })),
    }
  })
  return { overall_feedback: normalizeFeedback(marks.overallFeedback), campaigns }
}

/** Everything still stopping a submit — at least one campaign attached, every active
 *  check in each answered, and overall feedback written. Mirrors submit_sample_check()'s
 *  own rules (schema_073) so the UI never disagrees with the database about readiness. */
export interface SampleCheckIssue {
  campaignId?: string
  checkId?: string
  message: string
}

export function sampleCheckIssues(marks: SampleCheckMarks, special: SpecialCampaign[]): SampleCheckIssue[] {
  const issues: SampleCheckIssue[] = []
  const attached = marks.campaigns
  if (Object.keys(attached).length === 0) {
    issues.push({ message: 'Tick at least one Special Check campaign before submitting.' })
  }
  for (const def of special) {
    const answers = attached[def.id]
    if (!answers) continue
    for (const check of def.checks) {
      if (check.required && !answers[check.id]) {
        issues.push({ campaignId: def.id, checkId: check.id, message: `"${check.name}" in "${def.name}" needs an answer.` })
      }
    }
  }
  if (Object.keys(attached).length > 0 && normalizeFeedback(marks.overallFeedback) === '') {
    issues.push({ message: 'Write the overall feedback — it gives whoever reads this later the context for the check.' })
  }
  if (Array.from(normalizeFeedback(marks.overallFeedback)).length > FEEDBACK_LIMITS.overall) {
    issues.push({ message: `The overall feedback is longer than ${FEEDBACK_LIMITS.overall} characters.` })
  }
  return issues
}
