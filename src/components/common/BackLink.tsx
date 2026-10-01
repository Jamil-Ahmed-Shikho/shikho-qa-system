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
export function BackLink({ href, label, size = 'sm' }: { href: string; label: string; size?: 'sm' | 'lg' }) {
  return (
    <nav aria-label="Back" style={{ marginBottom: size === 'lg' ? '16px' : '12px' }}>
      <style>{`
        .shikho-back { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px 6px 0; min-height: 32px;
          font-size: 13px; color: var(--text-secondary); text-decoration: none; border-radius: var(--radius-sm); }
        .shikho-back:hover { color: var(--brand); text-decoration: underline; }
        .shikho-back:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
        .shikho-back-lg { font-size: 14.5px; font-weight: 600; color: var(--brand); padding: 8px 14px 8px 10px;
          min-height: 38px; background: var(--brand-light); border-radius: var(--radius-pill); }
        .shikho-back-lg:hover { color: var(--brand); text-decoration: none; background: var(--brand-light); filter: brightness(0.96); }
      `}</style>
      <Link
        href={href}
        className={size === 'lg' ? 'shikho-back shikho-back-lg' : 'shikho-back'}
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
