'use client'

import { useState } from 'react'

// Streams via our own /api/audits/[id]/recording proxy. If the browser
// can't play it, ask the proxy why (it answers failures with a small
// JSON { error }) and show that, rather than leaving a dead 0:00 player.
export function RecordingPlayer({ src }: { src: string }) {
  const [problem, setProblem] = useState<string | null>(null)

  async function explain() {
    try {
      const res = await fetch(src, { headers: { Range: 'bytes=0-0' } })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setProblem(body?.error ?? `The recording could not be loaded (HTTP ${res.status}).`)
        return
      }
    } catch {
      /* fall through to the generic message */
    }
    setProblem('The recording could not be played. Its format may not be supported by this browser.')
  }

  return (
    <div>
      {/* preload=metadata so the duration shows before pressing play */}
      <audio controls preload="metadata" src={src} style={{ width: '100%' }} onError={explain} />
      {problem && (
        <div style={{
          marginTop: '10px', background: 'var(--alert-light)', border: '1px solid var(--alert)',
          borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: '13px', color: 'var(--alert)',
        }}>
          {problem}
        </div>
      )}
    </div>
  )
}
