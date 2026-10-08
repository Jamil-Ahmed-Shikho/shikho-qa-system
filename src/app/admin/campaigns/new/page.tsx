import { BackLink } from '@/components/common/BackLink'
import { CampaignForm } from '@/components/admin/campaigns/CampaignForm'

export default function NewCampaignPage() {
  return (
    <div>
      <BackLink href="/admin/campaigns" label="All Special Checks" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 20px' }}>New Special Check</h1>
      <section style={{ background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)', borderRadius: 'var(--radius-md)', padding: '20px' }}>
        <CampaignForm mode="create" />
      </section>
    </div>
  )
}
