import { AppShell } from '@/components/layout/AppShell'

export default function AuditsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>{children}</div>
    </AppShell>
  )
}
