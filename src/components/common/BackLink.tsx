'use client'

import Link from 'next/link'
import { confirmLeave } from '@/lib/ui/unsaved'

/**
 * THE back link — one component, used on every page that isn't a home
 * (dashboard) page, so wording, position and behaviour are the same
 * everywhere. Points at the page's PARENT in the app's own hierarchy
 * (not `history.back()`), so it works the same after a refresh, a
 * bookmark or a link from an email, and never bounces you somewhere
 * unexpected. The browser's Back button still does what it always does.
 *
 * If something on the page has unsaved changes (see lib/ui/unsaved.ts),
 * leaving asks first.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <nav aria-label="Back" style={{ marginBottom: '12px' }}>
      <style>{`
        .shikho-back { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px 6px 0; min-height: 32px;
          font-size: 13px; color: var(--text-secondary); text-decoration: none; border-radius: var(--radius-sm); }
        .shikho-back:hover { color: var(--brand); text-decoration: underline; }
        .shikho-back:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
      `}</style>
      <Link
        href={href}
        className="shikho-back"
        onClick={(e) => {
          if (!confirmLeave()) e.preventDefault()
        }}
      >
        <span aria-hidden>←</span>
        <span>{label}</span>
      </Link>
    </nav>
  )
}
