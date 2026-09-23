import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth/auth.service'
import { generateUserImportTemplate } from '@/lib/users/bulk-import'

export async function GET() {
  const user = await getAuthUser()
  if (!user || !['super_admin', 'qa_manager'].includes(user.role)) {
    return NextResponse.json({ error: 'Permission denied.' }, { status: 403 })
  }

  const buffer = await generateUserImportTemplate()
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="shikho-qa-user-import-template.xlsx"',
    },
  })
}
