import { notFound } from 'next/navigation'
import { getCampaign } from '@/lib/campaigns/campaigns.service'
import { isUuid } from '@/lib/campaigns/validation'
import { CampaignEditor } from '@/components/admin/campaigns/CampaignEditor'

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const campaign = await getCampaign(id)
  if (!campaign) notFound()
  return <CampaignEditor tree={campaign.tree} usage={campaign.usage} />
}
