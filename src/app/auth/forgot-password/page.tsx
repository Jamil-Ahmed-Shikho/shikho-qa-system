import { Suspense } from 'react'
import { ForgotPasswordPage } from '@/components/auth/ForgotPasswordPage'

export default function Page() {
  return (
    <Suspense>
      <ForgotPasswordPage />
    </Suspense>
  )
}
