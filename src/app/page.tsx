import { redirect } from 'next/navigation'
import { getAuthUser, getPostLoginRedirect } from '@/lib/auth/auth.service'

export default async function HomePage() {
  const user = await getAuthUser()
  if (!user) redirect('/auth/login')
  redirect(getPostLoginRedirect(user))
}
