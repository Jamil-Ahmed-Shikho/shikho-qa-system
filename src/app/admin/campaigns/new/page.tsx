import Link from 'next/link'
import { CampaignForm } from '@/components/admin/campaigns/CampaignForm'

export default function NewCampaignPage() {
  return (
    <div>
      <Link href="/admin/campaigns" style={{ fontSize: '13px', color: 'var(--text-muted)', textDecoration: 'none' }}>← All campaigns</Link>
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '12px 0 20px' }}>New campaign</h1>
      <section style={{ background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)', borderRadius: 'var(--radius-md)', padding: '20px' }}>
        <CampaignForm mode="create" />
      </section>
    </div>
  )
}
