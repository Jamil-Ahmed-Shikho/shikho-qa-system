import Link from 'next/link'
import type { AgentDashboard, RygStatus } from '@/lib/agents/agent-dashboard.service'
import { formatDhakaDateTime } from '@/lib/dates/format'

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dhaka' }).format(new Date(iso))

const RYG_META: Record<RygStatus, { label: string; color: string; bg: string }> = {
  green: { label: 'Green — on track', color: '#0F1322', bg: 'linear-gradient(135deg, #4ADE95, #2E9E5B)' },
  yellow: { label: 'Yellow — keep an eye on it', color: '#0F1322', bg: 'linear-gradient(135deg, #FBC94B, var(--highlight))' },
  red: { label: 'Red — needs attention', color: '#FFFFFF', bg: 'linear-gradient(135deg, #FF7A8F, var(--alert))' },
  unrated: { label: 'Not yet rated', color: 'var(--text-secondary)', bg: 'var(--surface-1)' },
}

const card: React.CSSProperties = { background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }

export function AgentDashboardView({ data }: { data: AgentDashboard }) {
  const { ryg, thisWeek, lastWeek, mtdAvgScore, scoreTrend, topFailedParameters, recentCriticalFail, revenue, revenueFailed, coaching, openReviewRequest } = data
  const rygMeta = RYG_META[ryg.status]
  const heroScore = mtdAvgScore ?? ryg.avgAuditScore ?? thisWeek.avgScore ?? lastWeek.avgScore

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Hero */}
      <div
        style={{
          borderRadius: 'var(--radius-lg)', padding: '28px 26px', color: 'white',
          background: 'linear-gradient(135deg, var(--brand) 0%, #4A3A9E 55%, var(--accent) 130%)',
          display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <div>
          <p style={{ margin: '0 0 4px', fontSize: '13px', opacity: 0.85, fontWeight: 500, letterSpacing: '0.02em' }}>MY PERFORMANCE</p>
          <h1 style={{ margin: '0 0 12px', fontSize: '26px', fontWeight: 600, fontFamily: 'var(--font-display)' }}>Hi, {data.agentName.split(' ')[0]}</h1>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600,
            padding: '6px 14px', borderRadius: 'var(--radius-pill)', background: rygMeta.bg, color: rygMeta.color,
          }}>
            {rygMeta.label}
          </span>
        </div>
        {heroScore !== null && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '48px', fontWeight: 700, fontFamily: 'var(--font-display)', lineHeight: 1 }}>{heroScore}%</div>
            <div style={{ fontSize: '12px', opacity: 0.85, marginTop: '4px' }}>{mtdAvgScore !== null ? 'Average score this month' : 'Average score'}</div>
          </div>
        )}
      </div>

      {/* Critical fatal alert */}
      {recentCriticalFail && (
        <Link href={`/my-audits/${recentCriticalFail.auditId}`} style={{ textDecoration: 'none' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', borderRadius: 'var(--radius-md)',
            background: 'var(--alert-light)', border: '1px solid var(--alert)',
          }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--alert)', flexShrink: 0 }} />
            <span style={{ fontSize: '13.5px', color: 'var(--alert)', fontWeight: 500 }}>
              A serious issue was flagged on your audit from {formatDhakaDateTime(recentCriticalFail.submittedAt)}. Open it to see the details →
            </span>
          </div>
        </Link>
      )}

      {/* Review request status */}
      {openReviewRequest && (
        <Link href={`/my-audits/${openReviewRequest.auditId}`} style={{ textDecoration: 'none' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', borderRadius: 'var(--radius-md)',
            background: 'var(--brand-light)', border: '1px solid var(--brand)',
          }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--brand)', flexShrink: 0 }} />
            <span style={{ fontSize: '13.5px', color: 'var(--brand)', fontWeight: 500 }}>
              Your Review Request is {openReviewRequest.status === 'with_team_lead' ? 'with your Team Lead' : 'with QA Manager'} →
            </span>
          </div>
        </Link>
      )}

      {/* Weekly + MTD stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
        <StatTile label="This sales week" value={thisWeek.audits === 0 ? '—' : `${thisWeek.avgScore ?? '—'}%`} sub={`${thisWeek.audits} audit${thisWeek.audits === 1 ? '' : 's'} · ${thisWeek.passed} passed`} accent="var(--brand)" />
        <StatTile label="Last sales week" value={lastWeek.audits === 0 ? '—' : `${lastWeek.avgScore ?? '—'}%`} sub={`${lastWeek.audits} audit${lastWeek.audits === 1 ? '' : 's'} · ${lastWeek.passed} passed`} accent="var(--accent)" />
        <StatTile label="This month so far" value={mtdAvgScore === null ? '—' : `${mtdAvgScore}%`} sub="Average across all audits" accent="var(--highlight)" />
      </div>

      {/* Revenue */}
      <div>
        <SectionTitle>Your revenue</SectionTitle>
        {revenueFailed ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Could not be loaded right now — this does not mean it&apos;s zero.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
            <StatTile label={`Last week (${revenue?.lastWeek.weekStart ?? ''})`} value={revenue?.lastWeek.totalUsd === null ? 'Not available yet' : `$${revenue?.lastWeek.totalUsd?.toFixed(2)}`} sub="US dollars" accent="var(--highlight)" small />
            <StatTile label="This week so far" value={`$${(revenue?.currentWeek.totalUsd ?? 0).toFixed(2)}`} sub="US dollars, still counting" accent="var(--highlight)" small />
          </div>
        )}
      </div>

      {/* Score trend — the chart only; the full list with auditor/result/etc lives on "My audits" */}
      {scoreTrend.length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
            <SectionTitle>Your last {scoreTrend.length} audits</SectionTitle>
            <TrendBadge trend={scoreTrend} />
          </div>

          {scoreTrend.length > 1 ? <TrendChart trend={scoreTrend} /> : (
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '10px 0 0' }}>
              Score: <b style={{ color: 'var(--text-primary)' }}>{scoreTrend[0].scorePercent}%</b> on {shortDate(scoreTrend[0].submittedAt)}. One more audit and your trend will show here.
            </p>
          )}

          <Link href="/my-audits" style={{ display: 'inline-block', marginTop: '10px', fontSize: '12.5px', color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>
            See all audits →
          </Link>
        </div>
      )}

      {/* Focus areas */}
      {topFailedParameters.length > 0 && (
        <div style={card}>
          <SectionTitle>What to work on</SectionTitle>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '0 0 14px' }}>The rubric items that have cost you the most points in the last 90 days.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {topFailedParameters.map((p) => (
              <BarRow key={p.parameterId} label={p.name} value={p.failCount} max={topFailedParameters[0].failCount} display={`${p.failCount}×`} gradient="linear-gradient(90deg, var(--highlight), var(--alert))" />
            ))}
          </div>
        </div>
      )}

      {/* Coaching outcome */}
      {coaching && (
        <div style={card}>
          <SectionTitle>Your last coaching session</SectionTitle>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '0 0 14px' }}>{formatDhakaDateTime(coaching.scheduledAt)} — what we discussed, from that audit&apos;s feedback.</p>
          {coaching.failedParameters.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>That audit had no failed parameters — great call!</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {coaching.failedParameters.map((p, i) => (
                <div key={i} style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-1)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: p.feedback ? '4px' : 0 }}>{p.name}</div>
                  {p.feedback && <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>{p.feedback}</div>}
                </div>
              ))}
            </div>
          )}
          <Link href={`/my-audits/${coaching.auditId}`} style={{ display: 'inline-block', marginTop: '12px', fontSize: '12.5px', color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>
            Open that audit →
          </Link>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 12px', fontFamily: 'var(--font-display)' }}>{children}</h2>
}

function StatTile({ label, value, sub, accent, small }: { label: string; value: string; sub: string; accent: string; small?: boolean }) {
  return (
    <div style={{ ...card, padding: small ? '14px 16px' : '16px 18px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: accent }} />
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: small ? '20px' : '24px', fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: '2px' }}>{value}</div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{sub}</div>
    </div>
  )
}

function TrendBadge({ trend }: { trend: { scorePercent: number }[] }) {
  if (trend.length < 2) return null
  const delta = trend[trend.length - 1].scorePercent - trend[0].scorePercent
  const meta = delta > 2
    ? { label: 'Trending up', icon: '▲', color: 'var(--status-green)', bg: 'var(--status-green-light, #E3F7EC)' }
    : delta < -2
      ? { label: 'Trending down', icon: '▼', color: 'var(--alert)', bg: 'var(--alert-light)' }
      : { label: 'Holding steady', icon: '–', color: 'var(--text-muted)', bg: 'var(--surface-1)' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', fontWeight: 700,
      padding: '4px 10px', borderRadius: 'var(--radius-pill)', color: meta.color, background: meta.bg,
    }}>
      <span aria-hidden>{meta.icon}</span>{meta.label}
    </span>
  )
}

/** A plain-SVG line-and-stem chart, no charting library — matches the rest of this system's "plain
 * CSS/SVG, no dependency" convention for small visualizations (e.g. the Campaign Report's bar chart).
 * Each audit gets its own vertical reference line from 0 up to its score, so the chart reads as actual
 * magnitudes (out of 100), not just relative wiggle — per Jamil's own description, 2026-10-02. Every
 * point is a link to that audit (the one interaction this chart replaces the old row-list for). */
function TrendChart({ trend }: { trend: { auditId: string; submittedAt: string; scorePercent: number; passed: boolean | null; criticalFail: boolean }[] }) {
  const W = 760, H = 320
  const marginLeft = 32, marginRight = 10, marginTop = 28, marginBottom = 52
  const plotLeft = marginLeft, plotRight = W - marginRight
  const plotTop = marginTop, plotBottom = H - marginBottom
  const plotW = plotRight - plotLeft, plotH = plotBottom - plotTop
  const n = trend.length

  const x = (i: number) => (n > 1 ? plotLeft + (i / (n - 1)) * plotW : plotLeft + plotW / 2)
  const y = (score: number) => plotBottom - (Math.max(0, Math.min(100, score)) / 100) * plotH

  const points = trend.map((t, i) => ({ cx: x(i), cy: y(t.scorePercent), ...t }))
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.cx.toFixed(1)} ${p.cy.toFixed(1)}`).join(' ')
  const dotColor = (p: { passed: boolean | null; criticalFail: boolean }) =>
    p.criticalFail ? 'var(--alert)' : p.passed ? 'var(--status-green)' : 'var(--highlight)'

  const gridValues = [0, 25, 50, 75, 100]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" style={{ display: 'block', maxHeight: '340px' }} role="img" aria-label="Score trend across your recent audits, 0 to 100">
      <defs>
        <linearGradient id="agentTrendLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--brand)" />
          <stop offset="100%" stopColor="var(--accent)" />
        </linearGradient>
      </defs>

      {/* Horizontal gridlines, 0/25/50/75/100 */}
      {gridValues.map((v) => (
        <g key={v}>
          <line x1={plotLeft} x2={plotRight} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
          <text x={plotLeft - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">{v}</text>
        </g>
      ))}

      {/* Per-audit vertical stem, from the baseline up to the score */}
      {points.map((p, i) => (
        <line key={`stem-${i}`} x1={p.cx} x2={p.cx} y1={plotBottom} y2={p.cy} stroke={dotColor(p)} strokeOpacity={0.28} strokeWidth={2} />
      ))}

      <path d={path} fill="none" stroke="url(#agentTrendLine)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

      {points.map((p, i) => (
        <a key={i} href={`/my-audits/${p.auditId}`} aria-label={`Audit from ${shortDate(p.submittedAt)}, score ${p.scorePercent}%`}>
          <circle cx={p.cx} cy={p.cy} r={16} fill="transparent" />
          <text x={p.cx} y={p.cy - 12} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--text-primary)">{p.scorePercent}%</text>
          <circle cx={p.cx} cy={p.cy} r={5.5} fill={dotColor(p)} stroke="var(--paper)" strokeWidth={2} />
          <text
            x={p.cx}
            y={plotBottom + 18}
            textAnchor="end"
            fontSize={11}
            fill="var(--text-muted)"
            transform={`rotate(-38 ${p.cx} ${plotBottom + 18})`}
          >
            {shortDate(p.submittedAt)}
          </text>
        </a>
      ))}
    </svg>
  )
}

function BarRow({ label, value, max, display, gradient, href }: { label: string; value: number; max: number; display: string; gradient: string; href?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const row = (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 160px) 1fr auto', gap: '10px', alignItems: 'center' }}>
      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{label}</span>
      <div style={{ height: '14px', background: 'var(--surface-1)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: gradient, borderRadius: 'var(--radius-pill)', transition: 'width 220ms cubic-bezier(.22,.61,.36,1)' }} />
      </div>
      <span style={{ fontSize: '12.5px', fontWeight: 600, minWidth: '36px', textAlign: 'right' }}>{display}</span>
    </div>
  )
  return href ? <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>{row}</Link> : row
}
