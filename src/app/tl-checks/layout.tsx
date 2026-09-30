import { AppShell } from '@/components/layout/AppShell'

export default function TlChecksLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>{children}</div>
    </AppShell>
  )
}
