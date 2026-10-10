'use client'
// ============================================================
// SHIKHO QA SYSTEM — notification bell (schema_064, 2026-10-02)
// Polls loadNotificationsAction every POLL_MS, on open, and on returning to
// the tab — but NOT while the tab is hidden (2026-10-10, Vercel Hobby Active
// CPU reduction: this bell is mounted on every page for every signed-in
// user, so a 30s poll running in a background tab all day was the single
// biggest driver of invocation count — see the Oct-2 usage jump). A hidden
// tab stops the interval entirely rather than just skipping the fetch, so
// an all-day background tab costs nothing until it's actually looked at
// again, at which point it refreshes immediately. A failed load shows
// "could not load" in the dropdown rather than a silently empty bell (§14).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadNotificationsAction, markAllNotificationsReadAction, markNotificationsReadAction } from '@/lib/notifications/actions'
import type { NotificationItem } from '@/lib/notifications/notifications.service'

const POLL_MS = 120_000

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

const TYPE_ICON: Record<string, string> = {
  audit_submitted: 'ti-clipboard-check',
  audit_red_fatal: 'ti-alert-triangle',
  calibration_scheduled: 'ti-users',
  review_request_landed: 'ti-arrow-back-up',
  coaching_reminder: 'ti-bulb',
}

// Inline SVG, not the Tabler webfont glyph — the header bell must render even if the
// webfont CDN (layout.tsx) is slow, blocked, or offline, which otherwise leaves this
// button looking like an empty circle with nothing clickable inside it.
function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6" />
      <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
    </svg>
  )
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[] | null>(null)
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await loadNotificationsAction()
    if (res.ok) {
      setItems(res.items)
      setUnread(res.unread)
      setError(null)
    } else {
      setError(res.error)
    }
  }, [])

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null
    const stop = () => { if (id !== null) { clearInterval(id); id = null } }
    const start = () => { if (id === null) id = setInterval(load, POLL_MS) }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        load()
        start()
      } else {
        stop()
      }
    }

    load()
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [load])

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  async function onOpen() {
    const next = !open
    setOpen(next)
    if (next) await load()
  }

  async function onItemClick(n: NotificationItem) {
    if (!n.virtual && !n.readAt) {
      setItems((prev) => prev && prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)))
      setUnread((u) => Math.max(0, u - 1))
      await markNotificationsReadAction([n.id])
    }
    if (n.link) {
      setOpen(false)
      window.location.href = n.link
    }
  }

  async function onMarkAllRead() {
    setItems((prev) => prev && prev.map((x) => (x.virtual ? x : { ...x, readAt: x.readAt ?? new Date().toISOString() })))
    setUnread(0)
    await markAllNotificationsReadAction()
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <style>{`
        .shikho-bell-btn { transition: background-color .12s ease, border-color .12s ease; }
        .shikho-bell-btn:hover { background: var(--brand-light); border-color: var(--border-strong); }
        .shikho-bell-btn:active { background: var(--surface-2); }
        .shikho-bell-btn:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
      `}</style>
      <button
        className="shikho-bell-btn"
        onClick={onOpen}
        aria-label="Notifications"
        aria-expanded={open}
        style={{
          position: 'relative', width: '38px', height: '38px', borderRadius: '50%', border: '1px solid var(--border)',
          background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-primary)',
        }}
      >
        <BellIcon />
        {unread > 0 && (
          <span
            style={{
              position: 'absolute', top: '-2px', right: '-2px', minWidth: '16px', height: '16px', padding: '0 3px',
              borderRadius: '999px', background: 'var(--alert)', color: '#fff', fontSize: '10px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 10px)', right: 0, zIndex: 50,
            width: '340px', maxWidth: '90vw', maxHeight: '440px', overflowY: 'auto',
            background: 'var(--paper)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', boxShadow: '0 8px 24px rgba(15,19,34,0.14)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--paper)' }}>
            <span style={{ fontSize: '14px', fontWeight: 700 }}>Notifications</span>
            {items && items.some((n) => !n.readAt && !n.virtual) && (
              <button onClick={onMarkAllRead} style={{ background: 'none', border: 'none', color: 'var(--brand)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                Mark all read
              </button>
            )}
          </div>

          {error ? (
            <div role="alert" style={{ padding: '18px 16px', fontSize: '13px', color: 'var(--alert)' }}>Could not load notifications — this does not mean there are none.</div>
          ) : items === null ? (
            <div style={{ padding: '18px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Loading…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: '18px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Nothing yet.</div>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                role="menuitem"
                onClick={() => onItemClick(n)}
                style={{
                  display: 'flex', gap: '10px', padding: '12px 16px', cursor: n.link ? 'pointer' : 'default',
                  borderBottom: '1px solid var(--border)', background: n.readAt || n.virtual ? 'transparent' : 'var(--brand-light)',
                }}
              >
                <i className={`ti ${TYPE_ICON[n.type] ?? 'ti-bell'}`} style={{ fontSize: '16px', color: 'var(--brand)', marginTop: '2px', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{n.title}</div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.4 }}>{n.body}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{timeAgo(n.createdAt)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
