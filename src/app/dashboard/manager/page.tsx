import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/auth/auth.service'
import { PERIOD_OPTIONS, parsePeriod, periodRange } from '@/lib/dates/sales-week'
import { getManagerDashboard, listManagerOptions } from '@/lib/manager/dashboard.service'
import { ManagerDashboardView } from '@/components/dashboard/manager/ManagerDashboardView'
import { BriefingsSection } from '@/components/dashboard/BriefingsSection'
import { ManagerPicker } from '@/components/dashboard/manager/ManagerPicker'
import { loadManagerTlCheckCounts, type ManagerTlCheckCount } from '@/lib/team-lead-checks/team-lead-checks.service'
import { isMissingTlCheckSchema } from '@/lib/team-lead-checks/definitions.service'

export default async function ManagerDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; manager?: string }>
}) {
  const sp = await searchParams
  const user = await getAuthUser()
  if (!user) redirect('/auth/login')

  const period = parsePeriod(sp.period)
  const isManager = user.role === 'manager'

  // A Manager only ever sees their own chain — the ?manager= param is
  // ignored for them (and the database refuses it anyway). Admins can
  // pick any manager; a QA Manager defaults to their own chain (BPO).
  const options = isManager ? [] : await listManagerOptions()
  const requested = options.find((o) => o.id === sp.manager)?.id
  const managerId = isManager
    ? user.profile.id
    : requested ?? (user.role === 'qa_manager' ? user.profile.id : options[0]?.id)

  const result = managerId ? await getManagerDashboard(managerId, period) : null

  let tlCheckCounts: ManagerTlCheckCount[] = []
  let tlCheckFailure: unknown = null
  if (managerId) {
    const range = periodRange(period)
    try {
      tlCheckCounts = await loadManagerTlCheckCounts(managerId, range.from, range.to)
    } catch (err) {
      tlCheckFailure = err
      if (!isMissingTlCheckSchema(err)) console.error(err)
    }
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>
            {isManager ? 'Manager Dashboard' : 'Manager Dashboards'}
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
            {result?.ok
              ? `${result.managerName} · ${result.rangeLabel}`
              : 'Performance across a manager’s Team Lead reporting chain.'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <Link href="/reports/campaigns" style={{ fontSize: '13px', color: 'var(--brand)', textDecoration: 'none', fontWeight: 500 }}>
            Campaign Report →
          </Link>
          <Link href="/reports/repeat-mistakes" style={{ fontSize: '13px', color: 'var(--brand)', textDecoration: 'none', fontWeight: 500 }}>
            Repeat-Mistake Report →
          </Link>
          <Link href="/pip" style={{ fontSize: '13px', color: 'var(--brand)', textDecoration: 'none', fontWeight: 500 }}>
            PIPs in your chain →
          </Link>
          {isManager && (
            <Link href="/pip/review" style={{ fontSize: '13px', color: 'var(--brand)', textDecoration: 'none', fontWeight: 500 }}>
              PIP cycles to review →
            </Link>
          )}
          {isManager && (
            <Link href="/dashboard/manager/review-requests" style={{ fontSize: '13px', color: 'var(--brand)', textDecoration: 'none', fontWeight: 500 }}>
              Request a review →
            </Link>
          )}
          {!isManager && managerId && options.length > 0 && (
            <ManagerPicker options={options} selectedId={managerId} period={period} />
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {PERIOD_OPTIONS.map((p) => {
          const active = p.value === period
          const href = `/dashboard/manager?period=${p.value}${!isManager && managerId ? `&manager=${managerId}` : ''}`
          return (
            <Link
              key={p.value}
              href={href}
              style={{
                padding: '7px 14px', fontSize: '13px', fontWeight: 500, borderRadius: 'var(--radius-pill)',
                textDecoration: 'none', border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
                background: active ? 'var(--brand)' : 'var(--paper)', color: active ? 'white' : 'var(--text-secondary)',
              }}
            >
              {p.label}
            </Link>
          )
        })}
      </div>

      {!result && (
        <div style={{
          background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
          padding: '24px', color: 'var(--text-secondary)', fontSize: '14px',
        }}>
          There are no Managers yet. Add users with the Manager role in <Link href="/admin/users" style={{ color: 'var(--brand)', fontWeight: 600 }}>Users</Link>.
        </div>
      )}

      {result && !result.ok && (
        <div style={{
          background: 'var(--alert-light)', border: '1px solid var(--alert)', borderRadius: 'var(--radius-md)',
          padding: '16px 20px', color: 'var(--alert)', fontSize: '14px',
        }}>
          {result.error}
        </div>
      )}

      {result?.ok && <ManagerDashboardView rollup={result.rollup} managerName={result.managerName} />}

      {result?.ok && !isMissingTlCheckSchema(tlCheckFailure) && tlCheckCounts.length > 0 && (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginTop: '20px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 4px' }}>Team Leader Checks</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px' }}>
            How many quick checks each Team Lead has logged this period — a count only, not the details.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {tlCheckCounts.map((c) => (
              <div key={c.teamLeadId} style={{ background: 'var(--surface-1)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', minWidth: '140px' }}>
                <div style={{ fontSize: '20px', fontWeight: 700 }}>{c.checksCount}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.teamLeadName}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* A Manager's own chain (the database scopes it). Not shown to an admin browsing another manager: the sessions table has no per-manager filter, so it would show everyone's under that manager's name. */}
      {isManager && <BriefingsSection audience="scope" canOpenAudit={false} />}
    </div>
  )
}
