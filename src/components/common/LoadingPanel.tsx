// A small, calm "working on it" panel for route loading states (loading.tsx).
// Shown immediately on navigation, so a slow page never looks like a dead click.
export function LoadingPanel({ title, detail }: { title: string; detail?: string }) {
  return (
    <div role="status" aria-live="polite">
      <style>{`
        @keyframes shikho-spin { to { transform: rotate(360deg) } }
        @keyframes shikho-pulse { 0%, 100% { opacity: .45 } 50% { opacity: .9 } }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <span
          aria-hidden
          style={{
            width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
            borderStyle: 'solid', borderWidth: '2px', borderColor: 'var(--brand-light)', borderTopColor: 'var(--brand)',
            animation: 'shikho-spin 0.8s linear infinite',
          }}
        />
        <div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
          {detail && <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>{detail}</div>}
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden
          style={{
            height: i === 0 ? '84px' : '64px', background: 'var(--surface-1)', borderRadius: 'var(--radius-md)',
            marginBottom: '12px', animation: 'shikho-pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  )
}
