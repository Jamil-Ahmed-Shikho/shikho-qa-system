'use client'
// Buttons for the re-audit (CAPA) panel. Each calls a server action and refreshes the page;
// the database enforces every rule, so an error here is the database's own plain-language message.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { flagReauditAction, linkReauditAction, unflagReauditAction, unlinkReauditAction, type ActionResult } from '@/lib/capa/actions'
import { ghostBtn, primaryBtn, dangerBtn, disabledStyle } from '@/components/admin/users/styles'

function useRun() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(fn: () => Promise<ActionResult>) {
    setError(null)
    setBusy(true)
    const res = await fn()
    setBusy(false)
    if (!res.ok) return setError(res.error)
    router.refresh()
  }
  return { busy, error, run }
}

const Err = ({ error }: { error: string | null }) => (error ? <div role="alert" style={{ fontSize: '12px', color: 'var(--alert)', marginTop: '6px' }}>{error}</div> : null)

export function FlagReauditButton({ auditId }: { auditId: string }) {
  const { busy, error, run } = useRun()
  return (
    <div>
      <button style={{ ...primaryBtn, ...(busy ? disabledStyle : {}) }} disabled={busy}
        onClick={() => { if (confirm('Flag this audit as needing a follow-up re-audit? The agent\'s next audit can then be linked to it.')) run(() => flagReauditAction(auditId)) }}>
        {busy ? 'Flagging…' : 'Flag for re-audit'}
      </button>
      <Err error={error} />
    </div>
  )
}

export function UnflagReauditButton({ auditId }: { auditId: string }) {
  const { busy, error, run } = useRun()
  return (
    <div>
      <button style={{ ...dangerBtn, ...(busy ? disabledStyle : {}) }} disabled={busy}
        onClick={() => { if (confirm('Remove the re-audit flag from this audit?')) run(() => unflagReauditAction(auditId)) }}>
        {busy ? 'Removing…' : 'Remove flag'}
      </button>
      <Err error={error} />
    </div>
  )
}

export function LinkReauditButton({ draftAuditId, originalAuditId, label }: { draftAuditId: string; originalAuditId: string; label: string }) {
  const { busy, error, run } = useRun()
  return (
    <div>
      <button style={{ ...primaryBtn, ...(busy ? disabledStyle : {}) }} disabled={busy} onClick={() => run(() => linkReauditAction(draftAuditId, originalAuditId))}>
        {busy ? 'Linking…' : label}
      </button>
      <Err error={error} />
    </div>
  )
}

export function UnlinkReauditButton({ draftAuditId }: { draftAuditId: string }) {
  const { busy, error, run } = useRun()
  return (
    <div>
      <button style={{ ...ghostBtn, ...(busy ? disabledStyle : {}) }} disabled={busy} onClick={() => run(() => unlinkReauditAction(draftAuditId))}>
        {busy ? 'Unlinking…' : 'Unlink'}
      </button>
      <Err error={error} />
    </div>
  )
}
