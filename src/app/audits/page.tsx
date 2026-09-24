import { BackLink } from '@/components/common/BackLink'
import { LeadLookupForm } from '@/components/audits/LeadLookupForm'

export default function AuditsLookupPage() {
  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Find a Lead</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
        Find calls in Metabase first, then paste the lead ID or URL here to pull its call history.
      </p>
      <LeadLookupForm />
    </div>
  )
}
