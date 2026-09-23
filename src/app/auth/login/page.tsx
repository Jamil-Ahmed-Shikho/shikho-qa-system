import { Suspense } from 'react'
import { LoginPage } from '@/components/auth/LoginPage'

export default function Page() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  )
}
