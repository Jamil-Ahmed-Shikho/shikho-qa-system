'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ghostBtn, primaryBtn } from './styles'

interface RowResult {
  row: number
  name: string
  email: string
  status: 'created' | 'failed'
  reason?: string
  warnings: string[]
}

interface Summary {
  total: number
  created: number
  failed: number
  emailsFailed: number
  results: RowResult[]
}

export function BulkImportPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    setSummary(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/admin/users/bulk', { method: 'POST', body })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        setError(data?.error ?? 'Upload failed. Please try again.')
        return
      }
      setSummary(data as Summary)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setUploading(false)
    }
  }

  const problemRows = summary?.results.filter((r) => r.status === 'failed' || r.warnings.length > 0) ?? []

  return (
    <div style={{
      background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
      padding: '20px', marginBottom: '20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Bulk import from Excel</h3>
        <button type="button" style={ghostBtn} onClick={onClose}>Close</button>
      </div>

      <ol style={{ margin: '0 0 16px', paddingLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        <li>
          Download the template{' '}
          <a href="/api/admin/users/bulk/template" style={{ color: 'var(--brand)', fontWeight: 600 }}>shikho-qa-user-import-template.xlsx</a>
          {' '}— the Instructions sheet explains every column.
        </li>
        <li>Fill in one person per row (max 100 per upload). Supervisors are referenced by email.</li>
        <li>Upload it below. Each valid row gets an account and an emailed temporary password; invalid rows are skipped and listed.</li>
      </ol>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ fontSize: '13px' }}
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={!file || uploading}
          style={{
            ...primaryBtn,
            ...(!file || uploading ? { background: 'var(--surface-1)', color: 'var(--text-muted)', cursor: 'not-allowed' } : {}),
          }}
        >
          {uploading ? 'Importing… this can take a minute' : 'Upload & create accounts'}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: '14px', background: 'var(--alert-light)', border: '1px solid var(--alert)',
          borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: '13px', color: 'var(--alert)',
        }}>
          {error}
        </div>
      )}

      {summary && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <Stat label="Rows" value={summary.total} />
            <Stat label="Created" value={summary.created} color="var(--status-green)" />
            <Stat label="Failed" value={summary.failed} color={summary.failed ? 'var(--alert)' : undefined} />
            {summary.emailsFailed > 0 && <Stat label="Emails not sent" value={summary.emailsFailed} color="var(--highlight)" />}
          </div>

          {summary.emailsFailed > 0 && (
            <div style={{
              background: 'var(--highlight-light)', border: '1px solid var(--highlight)', borderRadius: 'var(--radius-sm)',
              padding: '10px 14px', fontSize: '13px', marginBottom: '12px',
            }}>
              {summary.emailsFailed} account(s) were created but their welcome email failed (usually Gmail SMTP not configured
              or over the daily send limit). Open each user and use <b>Reset password</b> once email is working.
            </div>
          )}

          {problemRows.length > 0 && (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-1)', textAlign: 'left' }}>
                    <th style={th}>Row</th><th style={th}>Name</th><th style={th}>Email</th><th style={th}>Result</th><th style={th}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {problemRows.map((r) => (
                    <tr key={r.row} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={td}>{r.row}</td>
                      <td style={td}>{r.name}</td>
                      <td style={td}>{r.email}</td>
                      <td style={{ ...td, color: r.status === 'failed' ? 'var(--alert)' : 'var(--highlight)', fontWeight: 600 }}>
                        {r.status === 'failed' ? 'Failed' : 'Created, with warnings'}
                      </td>
                      <td style={td}>{[r.reason, ...r.warnings].filter(Boolean).join(' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600 }
const td: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'top' }

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ background: 'var(--surface-0)', borderRadius: 'var(--radius-sm)', padding: '8px 14px' }}>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: '18px', fontWeight: 600, color }}>{value}</div>
    </div>
  )
}
