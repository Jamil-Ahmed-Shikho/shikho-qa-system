import { BackLink } from '@/components/common/BackLink'
import { NewRubricForm } from '@/components/admin/rubrics/NewRubricForm'

export default function NewRubricPage() {
  return (
    <div>
      <BackLink href="/admin/rubrics" label="All rubrics" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 20px' }}>New Rubric</h1>
      <NewRubricForm />
    </div>
  )
}
