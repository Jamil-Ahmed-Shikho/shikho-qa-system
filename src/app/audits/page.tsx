import { BackLink } from '@/components/common/BackLink'
import { LeadLookupForm } from '@/components/audits/LeadLookupForm'
import { getSupabaseServer } from '@/lib/supabase/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function AuditsLookupPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const sp = await searchParams
  // Arriving from the QA queue's "Audit" button: say who it was for. (The call browser scoped to that agent comes next;
  // for now the way in is still a lead ID or URL.)
  let agentName: string | null = null
  if (sp.agent && UUID_RE.test(sp.agent)) {
    const supabase = await getSupabaseServer()
    const { data } = await supabase.from('users').select('name').eq('id', sp.agent).maybeSingle()
    agentName = data?.name ?? null
  }
  return (
    <div>
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Find a Lead</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
        Find calls in Metabase first, then paste the lead ID or URL here to pull its call history.
      </p>
      {agentName && (
        <p role="status" style={{ fontSize: '14px', margin: '0 0 16px', padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--brand-light)' }}>
          Auditing a call by <b>{agentName}</b> — paste one of their lead IDs or URLs below.
        </p>
      )}
      <LeadLookupForm />
    </div>
  )
}
