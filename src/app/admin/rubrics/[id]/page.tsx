import { BackLink } from '@/components/common/BackLink'
import { notFound } from 'next/navigation'
import { getRubricTree } from '@/lib/rubrics/rubrics.service'
import { RubricEditor } from '@/components/admin/rubrics/RubricEditor'

export default async function RubricEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const rubric = await getRubricTree(id)
  if (!rubric) notFound()

  return (
    <div>
      <BackLink href="/admin/rubrics" label="All rubrics" />
      <RubricEditor rubric={rubric} />
    </div>
  )
}
