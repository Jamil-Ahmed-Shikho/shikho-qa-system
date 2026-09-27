import { redirect } from 'next/navigation'
import { BackLink } from '@/components/common/BackLink'
import { SessionForm } from '@/components/calibration/SessionForm'
import { getAuthUser } from '@/lib/auth/auth.service'
import { loadCandidates, loadRubricChoices } from '@/lib/calibration/calibration.service'
import { SITE_NAMES } from '@/lib/users/constants'
import { TEAM_NAMES } from '@/types/database.types'
import type { CalibrationKind } from '@/lib/calibration/validation'

export default async function NewCalibrationPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; call?: string; kind?: string }>
}) {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager', 'qa_auditor'].includes(user.role)) redirect('/calibration')
  const sp = await searchParams
  const [candidates, { rubrics, byTeam }] = await Promise.all([loadCandidates(), loadRubricChoices()])
  const kind: CalibrationKind = sp.kind === 'qa_only' ? 'qa_only' : 'team'

  return (
    <div>
      <BackLink href="/calibration" label="Calibration sessions" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>
        {kind === 'qa_only' ? 'Calibrate with QA teammates' : 'Schedule a calibration session'}
      </h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 8px', maxWidth: '620px' }}>
        Invited people can listen ahead of time and score the call on their own. Nothing is emailed at this stage.
      </p>
      <SessionForm
        mode="create"
        candidates={candidates}
        rubrics={rubrics}
        rubricByTeam={byTeam}
        teams={TEAM_NAMES}
        sites={SITE_NAMES}
        viewerId={user.profile.id}
        initial={{
          kind, title: '', itemType: 'call', itemReference: '',
          leadId: sp.lead ?? '', callId: sp.call ?? '', rubricId: '', teamName: '', siteName: '',
          scheduledLocal: '', participantIds: [],
        }}
      />
    </div>
  )
}
