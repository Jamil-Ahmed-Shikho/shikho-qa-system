'use client'
// ============================================================
// SHIKHO QA SYSTEM — a collapsible card section, so a long dashboard isn't
// one forced scroll. Built for the Team Lead dashboard standardization
// (2026-10-12) but generic — any page with several detail blocks can use
// it. `defaultOpen` is decided by the caller (typically: open when the
// section has something that needs attention, closed when it's routine).
// ============================================================

import { useState } from 'react'

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '24px' }
const sectionTitle: React.CSSProperties = { fontSize: '15px', fontWeight: 600, margin: 0 }
const sectionNote: React.CSSProperties = { fontSize: '13px', color: 'var(--text-muted)', margin: '2px 0 0' }

export function CollapsibleSection({
  id, title, subtitle, defaultOpen, badge, children,
}: {
  id?: string
  title: string
  subtitle: string
  defaultOpen: boolean
  /** A small chip/count shown next to the title, e.g. how many rows are inside — stays visible when collapsed. */
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div id={id} style={card}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: '10px', width: '100%', textAlign: 'left',
          background: 'none', border: 'none', padding: 0, margin: open ? '0 0 14px' : 0, cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '3px' }}>{open ? '▾' : '▸'}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h2 style={sectionTitle}>{title}</h2>
            {badge}
          </div>
          <p style={sectionNote}>{subtitle}</p>
        </div>
      </button>
      {open && children}
    </div>
  )
}
