// ============================================================
// SHIKHO QA SYSTEM — audit scoring rules (§3, §4)
// Pure module — safe for client and server.
//
// The confirmed rule (CLAUDE.md §3):
//   - a parameter earns its FULL points if it has zero error attributes
//     ticked, and 0 if one or more are ticked (Pass / Fail);
//   - total = sum of points earned, as a % of the rubric's points;
//   - any Critical fatal ticked zeroes the whole audit (critical_fail);
//     a Major fatal is recorded but doesn't change the score;
//   - passed = no critical fail AND score >= the pass mark (yellow_min).
//
// Special Check campaigns (Part B) are recorded on the scorecard but NEVER
// enter the score: they only add completeness rules (every active check of an
// attached campaign needs an answer; overall feedback becomes required).
//
// This module drives the LIVE score on the scorecard. The database
// (write_audit_results, schema_011 – 013) re-derives everything from the marks
// when the audit is submitted and is the authority — the two are kept in
// step by a randomized parity test, so what the auditor sees is what is
// stored.
// ============================================================

export const ROOT_CAUSES = ['skill', 'knowledge', 'process', 'attitude'] as const
export type RootCause = (typeof ROOT_CAUSES)[number]

export const ROOT_CAUSE_LABELS: Record<RootCause, string> = {
  skill: 'Skill',
  knowledge: 'Knowledge',
  process: 'Process',
  attitude: 'Attitude',
}

export interface ScorecardParameter {
  id: string
  name: string
  points: number
  errorAttributes: { id: string; description: string }[]
}

export interface ScorecardCategory {
  id: string
  name: string
  parameters: ScorecardParameter[]
}

export interface ScorecardFatal {
  id: string
  description: string
  severity: 'critical' | 'major'
}

export interface ScorecardRubric {
  id: string
  name: string
  version: number
  totalPoints: number
  categories: ScorecardCategory[]
  fatals: ScorecardFatal[]
}

/**
 * Feedback text limits, in characters. Kept in step with the database
 * (schema_012/013: write_audit_results and the table constraints).
 */
export const FEEDBACK_LIMITS = { parameter: 500, fatal: 1000, overall: 2000 } as const

/**
 * Feedback is stored trimmed. "Trimmed" means spaces, tabs and line breaks —
 * exactly what the database's btrim strips — so the two never disagree about
 * whether a field is blank.
 */
export function normalizeFeedback(text: string | null | undefined): string {
  return (text ?? '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
}

/** Length in characters (code points), the way Postgres counts them. */
function feedbackLength(text: string): number {
  return Array.from(text).length
}

/** What the auditor has marked on one parameter. `result: null` = not scored yet. */
export interface ParameterMark {
  result: 'pass' | 'fail' | null
  /** error attribute id -> root cause (null until they choose one) */
  ticks: Record<string, RootCause | null>
  /** Feedback for the agent on why it failed. REQUIRED to submit when result is 'fail'; meaningless (and refused) on a pass. */
  feedback?: string
}

export interface Marks {
  parameters: Record<string, ParameterMark>
  /** ids of the fatal errors ticked */
  fatals: string[]
  /** fatal error id -> feedback. REQUIRED to submit for every ticked fatal. */
  fatalFeedback: Record<string, string>
  /** An optional coaching summary — required once a Special Check campaign is attached. */
  overallFeedback: string
  /**
   * Special Check campaigns ATTACHED to this audit: campaign id -> (check id -> chosen option id).
   * A campaign is attached when it is a key, even with no answers yet. Never affects the score.
   */
  campaigns: Record<string, Record<string, string>>
}

/** What the engine needs to know about a campaign to judge completeness. (SpecialCampaign in campaigns/special.ts satisfies it.) */
export interface SpecialCampaignDef {
  id: string
  name: string
  checks: { id: string; name: string; required: boolean }[]
}

export type IssueKind =
  | 'rubric_points_mismatch'
  | 'unscored'
  | 'fail_without_tick'
  | 'tick_without_root_cause'
  | 'cannot_fail_no_attributes'
  | 'pass_with_ticks'
  | 'pass_with_feedback'
  | 'fail_without_feedback'
  | 'fatal_without_feedback'
  | 'feedback_too_long'
  | 'special_check_unanswered'
  | 'overall_feedback_required'

export interface Issue {
  kind: IssueKind
  parameterId?: string
  attributeId?: string
  fatalId?: string
  campaignId?: string
  checkId?: string
  message: string
}

export interface ScoreResult {
  earned: number
  possible: number
  /** 0-100, rounded to 2 dp; 0 whenever a Critical fatal is ticked. */
  percent: number
  /** What the parameters alone would give, ignoring fatals — for showing the auditor what a fatal is costing. */
  parametersPercent: number
  criticalFail: boolean
  criticalFatalIds: string[]
  majorFatalIds: string[]
  scoredCount: number
  totalCount: number
  /** Everything still stopping a submit. */
  issues: Issue[]
  ready: boolean
  /** null when no pass mark is known. */
  passed: boolean | null
}

// Matches Postgres round(numeric, 2) for the values we produce.
function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

export function emptyMarks(): Marks {
  return { parameters: {}, fatals: [], fatalFeedback: {}, overallFeedback: '', campaigns: {} }
}

export function scoreAudit(
  rubric: ScorecardRubric,
  marks: Marks,
  passMark: number | null,
  /** The Special Check campaigns on offer / attached (empty when there are none). They add issues, never points. */
  special: SpecialCampaignDef[] = [],
): ScoreResult {
  const issues: Issue[] = []
  let earned = 0
  let possible = 0
  let scored = 0
  let total = 0

  for (const category of rubric.categories) {
    for (const p of category.parameters) {
      total++
      possible += Number(p.points)
      const mark = marks.parameters[p.id]
      const attrIds = new Set(p.errorAttributes.map((a) => a.id))
      const ticked = mark ? Object.keys(mark.ticks).filter((id) => attrIds.has(id)) : []

      if (!mark || mark.result === null) {
        issues.push({ kind: 'unscored', parameterId: p.id, message: `"${p.name}" hasn't been scored.` })
        continue
      }
      scored++

      if (mark.result === 'pass') {
        earned += Number(p.points)
        if (ticked.length > 0) {
          issues.push({ kind: 'pass_with_ticks', parameterId: p.id, message: `"${p.name}" is marked Pass but has error attributes ticked.` })
        }
        if (normalizeFeedback(mark.feedback) !== '') {
          issues.push({ kind: 'pass_with_feedback', parameterId: p.id, message: `"${p.name}" is marked Pass but has feedback — feedback is only for failed parameters.` })
        }
        continue
      }

      // A failed parameter needs feedback for the agent — a ticked error and a
      // root cause say WHAT, this says what the agent should hear about it.
      const feedback = normalizeFeedback(mark.feedback)
      if (feedback === '') {
        issues.push({ kind: 'fail_without_feedback', parameterId: p.id, message: `"${p.name}" is failed — write feedback for the agent.` })
      } else if (feedbackLength(feedback) > FEEDBACK_LIMITS.parameter) {
        issues.push({ kind: 'feedback_too_long', parameterId: p.id, message: `The feedback on "${p.name}" is longer than ${FEEDBACK_LIMITS.parameter} characters.` })
      }

      // Fail: earns 0, and must say why.
      if (p.errorAttributes.length === 0) {
        issues.push({ kind: 'cannot_fail_no_attributes', parameterId: p.id, message: `"${p.name}" has no error attributes defined, so it can't be failed — add some in Rubric Admin.` })
      } else if (ticked.length === 0) {
        issues.push({ kind: 'fail_without_tick', parameterId: p.id, message: `"${p.name}" is failed — tick at least one error attribute.` })
      }
      for (const id of ticked) {
        if (!mark.ticks[id]) {
          const a = p.errorAttributes.find((x) => x.id === id)
          issues.push({ kind: 'tick_without_root_cause', parameterId: p.id, attributeId: id, message: `Choose a root cause for the ticked error under "${p.name}"${a ? `: ${a.description}` : ''}` })
        }
      }
    }
  }

  if (possible !== Number(rubric.totalPoints) || possible <= 0) {
    issues.unshift({
      kind: 'rubric_points_mismatch',
      message: `This rubric's parameters add up to ${possible} points but its total is ${rubric.totalPoints} — fix it in Rubric Admin before submitting audits.`,
    })
  }

  // The overall summary is optional — only its length is checked.
  if (feedbackLength(normalizeFeedback(marks.overallFeedback)) > FEEDBACK_LIMITS.overall) {
    issues.push({ kind: 'feedback_too_long', message: `The overall feedback is longer than ${FEEDBACK_LIMITS.overall} characters.` })
  }

  const fatalIds = new Set(marks.fatals)
  const ticked = rubric.fatals.filter((f) => fatalIds.has(f.id))

  // Every ticked fatal error (Critical or Major) needs its own feedback.
  for (const f of ticked) {
    const feedback = normalizeFeedback(marks.fatalFeedback[f.id])
    const label = f.description.length > 60 ? `${f.description.slice(0, 57)}…` : f.description
    if (feedback === '') {
      issues.push({ kind: 'fatal_without_feedback', fatalId: f.id, message: `The ${f.severity} fatal error "${label}" is ticked — write feedback for it.` })
    } else if (feedbackLength(feedback) > FEEDBACK_LIMITS.fatal) {
      issues.push({ kind: 'feedback_too_long', fatalId: f.id, message: `The feedback on the fatal error "${label}" is longer than ${FEEDBACK_LIMITS.fatal} characters.` })
    }
  }
  const criticalFatalIds = ticked.filter((f) => f.severity === 'critical').map((f) => f.id)
  const majorFatalIds = ticked.filter((f) => f.severity === 'major').map((f) => f.id)
  const criticalFail = criticalFatalIds.length > 0

  // Special Checks: only ATTACHED campaigns ask for anything. Every active check needs an answer,
  // and the overall feedback becomes required. None of this touches the score.
  const attached = marks.campaigns ?? {}
  for (const def of special) {
    const answers = attached[def.id]
    if (!answers) continue
    for (const check of def.checks) {
      if (check.required && !answers[check.id]) {
        issues.push({ kind: 'special_check_unanswered', campaignId: def.id, checkId: check.id, message: `"${check.name}" in the Special Check "${def.name}" needs an answer.` })
      }
    }
  }
  if (Object.keys(attached).length > 0 && normalizeFeedback(marks.overallFeedback) === '') {
    issues.push({ kind: 'overall_feedback_required', message: 'Write the overall feedback — it is required when a Special Check is attached.' })
  }

  const parametersPercent = possible > 0 ? round2((earned / possible) * 100) : 0
  const percent = criticalFail ? 0 : parametersPercent

  return {
    earned,
    possible,
    percent,
    parametersPercent,
    criticalFail,
    criticalFatalIds,
    majorFatalIds,
    scoredCount: scored,
    totalCount: total,
    issues,
    ready: issues.length === 0,
    passed: passMark === null ? null : !criticalFail && percent >= passMark,
  }
}

// ── Payload sent to the server (marks only — never numbers) ──

export interface MarksPayload {
  /** `feedback` is only ever set on a failed parameter; null otherwise. */
  results: { parameter_id: string; passed: boolean; feedback: string | null }[]
  ticks: { parameter_id: string; error_attribute_id: string; root_cause_category: RootCause | null }[]
  /** Each ticked fatal error with its feedback (required to submit; null while a draft hasn't written it yet). */
  fatals: { fatal_parameter_id: string; feedback: string | null }[]
  /** Optional (required once a campaign is attached); trimmed; '' when not written. */
  overall_feedback: string
  /**
   * The campaigns attached to the audit with their answers — the FULL new state.
   * null = "not provided" (an older page): the database leaves the existing links alone.
   */
  campaigns: SpecialPayload[] | null
}

export interface SpecialPayload {
  campaign_id: string
  answers: { check_type_id: string; value_id: string }[]
}

export function toPayload(rubric: ScorecardRubric, marks: Marks, special: SpecialCampaignDef[] | null = null): MarksPayload {
  const results: MarksPayload['results'] = []
  const ticks: MarksPayload['ticks'] = []
  for (const category of rubric.categories) {
    for (const p of category.parameters) {
      const mark = marks.parameters[p.id]
      if (!mark || mark.result === null) continue
      results.push({
        parameter_id: p.id,
        passed: mark.result === 'pass',
        feedback: mark.result === 'fail' ? normalizeFeedback(mark.feedback) || null : null,
      })
      if (mark.result === 'fail') {
        for (const a of p.errorAttributes) {
          if (a.id in mark.ticks) {
            ticks.push({ parameter_id: p.id, error_attribute_id: a.id, root_cause_category: mark.ticks[a.id] ?? null })
          }
        }
      }
    }
  }
  const validFatal = new Set(rubric.fatals.map((f) => f.id))
  const fatals = [...new Set(marks.fatals)]
    .filter((id) => validFatal.has(id))
    .map((id) => ({ fatal_parameter_id: id, feedback: normalizeFeedback(marks.fatalFeedback[id]) || null }))
  return { results, ticks, fatals, overall_feedback: normalizeFeedback(marks.overallFeedback), campaigns: campaignsPayload(marks, special) }
}

/**
 * The attached campaigns as a payload. When the definitions are known, unknown campaigns and checks are
 * dropped and the order follows the definitions, so the same state always produces the same payload
 * (which the "unsaved changes" comparison relies on). Without definitions it passes marks through in key order.
 */
function campaignsPayload(marks: Marks, special: SpecialCampaignDef[] | null): SpecialPayload[] {
  const attached = marks.campaigns ?? {}
  const ids = special ? special.filter((d) => d.id in attached).map((d) => d.id) : Object.keys(attached)
  return ids.map((id) => {
    const chosen = attached[id] ?? {}
    const checkIds = special ? (special.find((d) => d.id === id)?.checks.map((c) => c.id) ?? []) : Object.keys(chosen)
    return {
      campaign_id: id,
      answers: checkIds.filter((c) => chosen[c]).map((c) => ({ check_type_id: c, value_id: chosen[c] })),
    }
  })
}

/** Rebuilds the marks from what was saved (a saved draft) — the inverse of toPayload. */
export function marksFromPayload(payload: MarksPayload): Marks {
  const parameters: Marks['parameters'] = {}
  for (const r of payload.results) {
    parameters[r.parameter_id] = { result: r.passed ? 'pass' : 'fail', ticks: {} }
    if (r.feedback) parameters[r.parameter_id].feedback = r.feedback
  }
  for (const t of payload.ticks) {
    const p = parameters[t.parameter_id]
    if (p) p.ticks[t.error_attribute_id] = t.root_cause_category
  }
  const fatalFeedback: Marks['fatalFeedback'] = {}
  for (const f of payload.fatals) if (f.feedback) fatalFeedback[f.fatal_parameter_id] = f.feedback
  const campaigns: Marks['campaigns'] = {}
  for (const c of payload.campaigns ?? []) {
    campaigns[c.campaign_id] = Object.fromEntries(c.answers.map((a) => [a.check_type_id, a.value_id]))
  }
  return { parameters, fatals: payload.fatals.map((f) => f.fatal_parameter_id), fatalFeedback, overallFeedback: payload.overall_feedback ?? '', campaigns }
}

// ── Validating what arrives from the browser ─────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

export function parsePayload(input: unknown): { ok: true; payload: MarksPayload } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error })
  if (!input || typeof input !== 'object') return bad('Malformed scorecard.')
  const { results, ticks, fatals, overall_feedback, campaigns } = input as Record<string, unknown>
  if (!Array.isArray(results) || !Array.isArray(ticks) || !Array.isArray(fatals)) return bad('Malformed scorecard.')
  if (results.length > 200 || ticks.length > 2000 || fatals.length > 200) return bad('Scorecard is too large.')

  // A missing overall_feedback (e.g. a browser tab still running an older
  // version of the page) reads as "not written" — it's optional.
  if (overall_feedback !== undefined && overall_feedback !== null && typeof overall_feedback !== 'string') return bad('Malformed overall feedback.')
  const overall = normalizeFeedback(overall_feedback as string | null | undefined)
  if (feedbackLength(overall) > FEEDBACK_LIMITS.overall) return bad(`Overall feedback is too long (the limit is ${FEEDBACK_LIMITS.overall} characters).`)

  // campaigns: absent/null = an older page that doesn't know about them (leave the stored ones alone).
  let parsedCampaigns: SpecialPayload[] | null = null
  if (campaigns !== undefined && campaigns !== null) {
    if (!Array.isArray(campaigns) || campaigns.length > 50) return bad('Malformed Special Check data.')
    parsedCampaigns = []
    for (const c of campaigns) {
      const x = c as Record<string, unknown>
      if (!x || !isUuid(x.campaign_id) || !Array.isArray(x.answers) || x.answers.length > 200) return bad('Malformed Special Check data.')
      const answers: SpecialPayload['answers'] = []
      for (const a of x.answers) {
        const y = a as Record<string, unknown>
        if (!y || !isUuid(y.check_type_id) || !isUuid(y.value_id)) return bad('Malformed Special Check answer.')
        answers.push({ check_type_id: y.check_type_id, value_id: y.value_id })
      }
      parsedCampaigns.push({ campaign_id: x.campaign_id, answers })
    }
  }

  const out: MarksPayload = { results: [], ticks: [], fatals: [], overall_feedback: overall, campaigns: parsedCampaigns }
  for (const r of results) {
    const x = r as Record<string, unknown>
    if (!x || !isUuid(x.parameter_id) || typeof x.passed !== 'boolean') return bad('Malformed parameter result.')
    if (x.feedback !== undefined && x.feedback !== null && typeof x.feedback !== 'string') return bad('Malformed parameter feedback.')
    const feedback = normalizeFeedback(x.feedback as string | null | undefined)
    if (feedbackLength(feedback) > FEEDBACK_LIMITS.parameter) return bad(`Feedback on a parameter is too long (the limit is ${FEEDBACK_LIMITS.parameter} characters).`)
    // Feedback belongs to a failed parameter; on a Pass it's dropped, as ticks are.
    out.results.push({ parameter_id: x.parameter_id, passed: x.passed, feedback: x.passed ? null : feedback || null })
  }
  for (const t of ticks) {
    const x = t as Record<string, unknown>
    if (!x || !isUuid(x.parameter_id) || !isUuid(x.error_attribute_id)) return bad('Malformed error attribute.')
    const rc = x.root_cause_category
    if (rc !== null && rc !== undefined && !(ROOT_CAUSES as readonly unknown[]).includes(rc)) return bad('Unknown root-cause category.')
    out.ticks.push({ parameter_id: x.parameter_id, error_attribute_id: x.error_attribute_id, root_cause_category: (rc as RootCause | null | undefined) ?? null })
  }
  for (const f of fatals) {
    // A bare id (an older page still open in a tab) is accepted as "ticked, no feedback yet":
    // it saves as a draft but can't be submitted.
    const x = (typeof f === 'string' ? { fatal_parameter_id: f } : f) as Record<string, unknown> | null
    if (!x || typeof x !== 'object' || !isUuid(x.fatal_parameter_id)) return bad('Malformed fatal error.')
    if (x.feedback !== undefined && x.feedback !== null && typeof x.feedback !== 'string') return bad('Malformed fatal error feedback.')
    const feedback = normalizeFeedback(x.feedback as string | null | undefined)
    if (feedbackLength(feedback) > FEEDBACK_LIMITS.fatal) return bad(`Feedback on a fatal error is too long (the limit is ${FEEDBACK_LIMITS.fatal} characters).`)
    out.fatals.push({ fatal_parameter_id: x.fatal_parameter_id, feedback: feedback || null })
  }
  return { ok: true, payload: out }
}
