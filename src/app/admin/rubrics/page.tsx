import Link from 'next/link'
import { listRubrics } from '@/lib/rubrics/rubrics.service'

export default async function RubricsListPage() {
  const rubrics = await listRubrics()

  // Group by name so versions of the same rubric sit together.
  const groups = new Map<string, typeof rubrics>()
  for (const r of rubrics) {
    const list = groups.get(r.name) ?? []
    list.push(r)
    groups.set(r.name, list)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Rubrics</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
            Scoring rubrics used for audits — each is versioned, never edited in place once live.
          </p>
        </div>
        <Link
          href="/admin/rubrics/new"
          style={{
            padding: '10px 18px',
            fontSize: '14px',
            fontWeight: 500,
            color: 'white',
            background: 'var(--brand)',
            borderRadius: 'var(--radius-sm)',
            textDecoration: 'none',
          }}
        >
          + New Rubric
        </Link>
      </div>

      {groups.size === 0 && (
        <div style={{
          background: 'var(--paper)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: '32px', textAlign: 'center',
          color: 'var(--text-muted)', fontSize: '14px',
        }}>
          No rubrics yet. Create the first one to get started.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {[...groups.entries()].map(([name, versions]) => (
          <div key={name} style={{
            background: 'var(--paper)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: '15px' }}>
              {name}
            </div>
            <div>
              {versions.map((r) => (
                <Link
                  key={r.id}
                  href={`/admin/rubrics/${r.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 18px', textDecoration: 'none', color: 'var(--text-primary)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px' }}>
                    <span>v{r.version}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{r.total_points} pts</span>
                    {r.team_rubric_mapping.length > 0 && (
                      <span style={{ color: 'var(--text-muted)' }}>
                        · {r.team_rubric_mapping.map((m) => m.team_name).join(', ')}
                      </span>
                    )}
                  </div>
                  <span style={{
                    fontSize: '12px', fontWeight: 600, padding: '3px 10px', borderRadius: 'var(--radius-pill)',
                    background: r.is_active ? '#E5F5EC' : 'var(--surface-1)',
                    color: r.is_active ? 'var(--status-green)' : 'var(--text-muted)',
                  }}>
                    {r.is_active ? 'Active' : 'Superseded'}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
