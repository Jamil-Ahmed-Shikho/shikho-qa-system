// Pure — no server imports, so client components (RepeatMistakeGroups.tsx) can import this
// directly instead of pulling in repeat-mistakes.service.ts's getSupabaseServer() chain (§14).

export type RepeatMistakeStatus = 'still_failing' | 'improved' | 'not_yet_rechecked'

export const STATUS_LABEL: Record<RepeatMistakeStatus, string> = {
  still_failing: 'Still failing',
  improved: 'Improved',
  not_yet_rechecked: 'Not yet re-checked',
}

export interface RepeatMistakeRow {
  agentId: string
  agentName: string
  teamName: string | null
  siteName: string | null
  teamLeaderName: string | null
  parameterId: string
  parameterName: string
  failCount: number
  status: RepeatMistakeStatus
  firstFlaggedAt: string
  lastCheckedAt: string | null
}
