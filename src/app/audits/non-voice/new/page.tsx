import { BackLink } from '@/components/common/BackLink'
import { StartNonVoiceAuditForm } from '@/components/audits/StartNonVoiceAuditForm'
import { listAgentsForNonVoiceAudit } from '@/lib/audits/actions'

export default async function StartNonVoiceAuditPage() {
  const agents = await listAgentsForNonVoiceAudit()
  return (
    <div>
      <BackLink href="/audits" label="Find a Lead" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Start a Non-Voice Audit</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '640px' }}>
        For a chat, comment or ticket with no CRM call record (app/web chat, YouTube, Instagram, Email,
        Facebook, social media groups). Pick the agent, paste the ticket link or ID, and score it
        against their normal rubric — exactly like a call audit from here on.
      </p>
      <StartNonVoiceAuditForm agents={agents} />
    </div>
  )
}
