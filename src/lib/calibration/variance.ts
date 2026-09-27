// ============================================================
// SHIKHO QA SYSTEM — Calibration variance report (§5, Stage 3)
// Pure (no server imports): also used by the results email in Stage 4.
// Describes how far each participant's score sat from the group; it does NOT
// judge anyone — no pass/fail line is invented, just the numbers.
// ============================================================

export interface ParticipantScore {
  userId: string
  name: string
  role: string
  scorePercent: number
  criticalFail: boolean
  notes: string | null
  /** parameter id -> passed */
  params: Record<string, boolean>
  fatalIds: string[]
}

export interface RubricShape {
  categories: { name: string; parameters: { id: string; name: string; points: number }[] }[]
  fatals: { id: string; description: string; severity: 'critical' | 'major' }[]
}

export interface ParticipantVariance {
  userId: string
  name: string
  role: string
  scorePercent: number
  criticalFail: boolean
  /** score minus the group mean, in points (positive = scored higher than the group) */
  deviation: number
  position: 'highest' | 'lowest' | 'middle' | 'only'
  notes: string | null
}

export interface ParameterAgreement {
  parameterId: string
  name: string
  category: string
  points: number
  passed: string[]
  failed: string[]
  unanimous: boolean
}

export interface FatalAgreement {
  fatalId: string
  description: string
  severity: 'critical' | 'major'
  ticked: string[]
  notTicked: string[]
  unanimous: boolean
}

export interface VarianceReport {
  count: number
  mean: number
  min: number
  max: number
  /** max - min */
  range: number
  /** population standard deviation */
  stdDev: number
  participants: ParticipantVariance[]
  /** only the parameters the group did NOT agree on */
  splitParameters: ParameterAgreement[]
  allParameters: ParameterAgreement[]
  fatals: FatalAgreement[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function buildVarianceReport(scores: ParticipantScore[], rubric: RubricShape): VarianceReport {
  const n = scores.length
  const values = scores.map((s) => s.scorePercent)
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : 0
  const min = n ? Math.min(...values) : 0
  const max = n ? Math.max(...values) : 0
  const stdDev = n ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / n) : 0

  const participants: ParticipantVariance[] = scores
    .map((s) => ({
      userId: s.userId,
      name: s.name,
      role: s.role,
      scorePercent: s.scorePercent,
      criticalFail: s.criticalFail,
      deviation: r2(s.scorePercent - mean),
      // Everyone tied on one value has no highest/lowest.
      position: (n === 1 ? 'only' : min === max ? 'middle' : s.scorePercent === max ? 'highest' : s.scorePercent === min ? 'lowest' : 'middle') as ParticipantVariance['position'],
      notes: s.notes,
    }))
    .sort((a, b) => b.scorePercent - a.scorePercent || a.name.localeCompare(b.name))

  const allParameters: ParameterAgreement[] = []
  for (const c of rubric.categories) {
    for (const p of c.parameters) {
      const passed = scores.filter((s) => s.params[p.id] === true).map((s) => s.name)
      const failed = scores.filter((s) => s.params[p.id] === false).map((s) => s.name)
      allParameters.push({ parameterId: p.id, name: p.name, category: c.name, points: p.points, passed, failed, unanimous: passed.length === 0 || failed.length === 0 })
    }
  }

  const fatals: FatalAgreement[] = rubric.fatals
    .map((f) => {
      const ticked = scores.filter((s) => s.fatalIds.includes(f.id)).map((s) => s.name)
      const notTicked = scores.filter((s) => !s.fatalIds.includes(f.id)).map((s) => s.name)
      return { fatalId: f.id, description: f.description, severity: f.severity, ticked, notTicked, unanimous: ticked.length === 0 || notTicked.length === 0 }
    })
    // Only fatals someone ticked are worth reporting.
    .filter((f) => f.ticked.length > 0)

  return {
    count: n, mean: r2(mean), min: r2(min), max: r2(max), range: r2(max - min), stdDev: r2(stdDev),
    participants, allParameters, splitParameters: allParameters.filter((p) => !p.unanimous), fatals,
  }
}
