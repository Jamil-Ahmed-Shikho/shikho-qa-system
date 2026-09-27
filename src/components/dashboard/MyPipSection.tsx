// §6.4, Stage 6: the agent's own PIP status, in-app only (no email — that's Stage 7, deliberately
// last and off by default). Renders nothing when the agent isn't currently on a PIP — most agents,
// most of the time — never an empty "you're not on a PIP" card. A failed read says so; it never
// silently renders as "not on a PIP", which would be a worse lie than showing an error (§14).

import { loadMyPip } from '@/lib/pip/pip.service'
import { fmtDate, fmtMoney } from '@/components/pip/pip-display'

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '18px 20px', marginTop: '20px',
}

export async function MyPipSection() {
  let result: Awaited<ReturnType<typeof loadMyPip>>
  try {
    result = await loadMyPip()
  } catch (err) {
    console.error(err)
    return (
      <section style={{ ...card, borderColor: 'var(--alert)' }} aria-label="My PIP status">
        <div style={{ fontSize: '13px', color: 'var(--alert)' }}>
          Your PIP status could not be checked right now. This does not mean you are on one — try again shortly.
        </div>
      </section>
    )
  }
  if (!result) return null
  const { candidate: c, achievementUsd } = result

  return (
    <section style={{ ...card, borderColor: 'var(--alert)' }} aria-label="My PIP status">
      <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px', color: 'var(--alert)' }}>You are currently on a Performance Improvement Plan</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Period: {fmtDate(c.cycleStart)} – {fmtDate(c.cycleEnd)}
      </p>
      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: c.incentiveDowngraded ? '12px' : 0 }}>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Target</div>
          <div style={{ fontSize: '18px', fontWeight: 600 }}>{fmtMoney(c.targetRevenue, 'USD')}</div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Achievement so far</div>
          <div style={{ fontSize: '18px', fontWeight: 600 }}>
            {achievementUsd === null ? <span style={{ fontSize: '13px', fontWeight: 400, color: 'var(--text-muted)' }}>could not be loaded</span> : fmtMoney(achievementUsd, 'USD')}
          </div>
        </div>
      </div>
      {c.incentiveDowngraded && (
        <div style={{ fontSize: '13px', color: 'var(--alert)' }}>
          Your incentive slab has been downgraded due to being on this PIP.
        </div>
      )}
    </section>
  )
}
