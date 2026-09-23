import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getAuthUser } from '@/lib/auth/auth.service'
import { bulkCreateUsers } from '@/lib/users/bulk-import'

// Each row creates a login + sends an email; give a full import room to
// finish rather than being cut off at the default serverless limit.
export const maxDuration = 60

const MAX_FILE_BYTES = 2 * 1024 * 1024

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager'].includes(user.role)) {
    return NextResponse.json({ error: 'Permission denied.' }, { status: 403 })
  }

  const formData = await req.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'Please upload an .xlsx file (use the template).' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File is too large (2 MB max).' }, { status: 400 })
  }

  const result = await bulkCreateUsers(user, Buffer.from(await file.arrayBuffer()))
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })

  revalidatePath('/admin/users')
  return NextResponse.json(result.summary)
}
