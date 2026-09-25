import { AppShell } from '@/components/layout/AppShell'

export default function PipLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>{children}</div>
    </AppShell>
  )
}
