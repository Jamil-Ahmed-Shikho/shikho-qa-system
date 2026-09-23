import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/auth/auth.service'
import { listUsers } from '@/lib/users/users.service'
import { UsersAdminClient } from '@/components/admin/users/UsersAdminClient'

export default async function UsersAdminPage() {
  const user = await getAuthUser()
  if (!user) redirect('/auth/login')

  const users = await listUsers()

  return <UsersAdminClient users={users} currentUserId={user.profile.id} currentRole={user.role} />
}
