import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRubricTree } from '@/lib/rubrics/rubrics.service'
import { RubricEditor } from '@/components/admin/rubrics/RubricEditor'

export default async function RubricEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const rubric = await getRubricTree(id)
  if (!rubric) notFound()

  return (
    <div>
      <Link href="/admin/rubrics" style={{ fontSize: '13px', color: 'var(--text-muted)', textDecoration: 'none' }}>
        ← All rubrics
      </Link>
      <div style={{ height: '12px' }} />
      <RubricEditor rubric={rubric} />
    </div>
  )
}
