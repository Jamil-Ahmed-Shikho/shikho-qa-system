import Link from 'next/link'
import { CAPA_LABEL, type AuditRef, type CapaInfo, type CapaStatus } from '@/lib/capa/capa.service'
import { formatDhakaDateTime } from '@/lib/dates/format'
import { FlagReauditButton, LinkReauditButton, UnflagReauditButton, UnlinkReauditButton } from './CapaControls'

const card: React.CSSProperties = {
  background: 'var(--paper)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--border)',
  borderRadius: 'var(--radius-md)', padding: '16px 18px', marginBottom: '20px',
}
const title: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }

const TONE: Record<CapaStatus, string> = { pending_reaudit: 'var(--highlight)', passed: 'var(--status-green)', failed_again: 'var(--alert)' }

function Badge({ status }: { status: CapaStatus }) {
  return (
    <span style={{
      fontSize: '11px', fontWeight: 700, padding: '2px 9px', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
      borderStyle: 'solid', borderWidth: '1px', borderColor: TONE[status], color: TONE[status],
    }}>{CAPA_LABEL[status]}</span>
  )
}

function When({ r }: { r: AuditRef }) {
  const t = r.submittedAt ?? r.createdAt
  return <>{formatDhakaDateTime(t)}{r.scorePercent !== null && <> · {r.scorePercent}%{r.passed === false ? ' (did not pass)' : r.passed ? ' (passed)' : ''}</>}</>
}

/**
 * The re-audit (CAPA) section of an audit page. Shows only what applies:
 *  - this audit follows up a failed one (with Unlink while it is still a draft);
 *  - this audit did not pass — QA can flag it, see where it stands, or remove the flag;
 *  - this is a draft and the agent has audits waiting for a re-audit — offer to link.
 * Returns nothing at all for an audit that has no re-audit story.
 */
export function CapaPanel({
  audit,
  info,
  canFlag,
  isDraftOwner,
  agentName,
}: {
  audit: { id: string; status: string; passed: boolean | null }
  info: CapaInfo
  /** QA Manager / Super Admin, or the QA Auditor who conducted this audit. */
  canFlag: boolean
  /** The signed-in user owns this draft (so may link / unlink it). */
  isDraftOwner: boolean
  agentName: string
}) {
  const isDraft = audit.status === 'draft'
  const failed = !isDraft && audit.passed === false
  const showFollowsUp = !!info.followsUp
  const showOwn = failed && (info.capaStatus !== null || canFlag)
  const showLinkOffer = isDraft && isDraftOwner && info.linkable.length > 0
  if (!showFollowsUp && !showOwn && !showLinkOffer) return null

  return (
    <section style={card} aria-label="Re-audit (CAPA)">
      <div style={title}>Re-audit</div>

      {showFollowsUp && info.followsUp && (
        <div style={{ marginBottom: showOwn || showLinkOffer ? '14px' : 0 }}>
          <div style={{ fontSize: '14px' }}>
            This audit is the <b>follow-up re-audit</b> of{' '}
            <Link href={`/audits/${info.followsUp.id}`} style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>an earlier audit</Link>{' '}
            of {agentName} (<When r={info.followsUp} />).
          </div>
          {isDraft && isDraftOwner && (
            <div style={{ marginTop: '8px' }}><UnlinkReauditButton draftAuditId={audit.id} /></div>
          )}
          {isDraft && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>When you submit this audit, the earlier one is marked as passed or failed again by the result.</div>}
          {!isDraft && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>The link is fixed now that this audit is submitted.</div>}
        </div>
      )}

      {showOwn && (
        <div>
          {info.capaStatus === null && (
            <>
              <div style={{ fontSize: '14px', marginBottom: '10px' }}>This audit did not pass. QA can flag it as needing a follow-up re-audit; the next audit of {agentName} can then be linked to it.</div>
              <FlagReauditButton auditId={audit.id} />
            </>
          )}
          {info.capaStatus === 'pending_reaudit' && (
            <>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
                <Badge status="pending_reaudit" />
                <span style={{ fontSize: '14px' }}>
                  {info.followedBy
                    ? <>A follow-up is in progress: <Link href={`/audits/${info.followedBy.id}`} style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>open the {info.followedBy.status === 'draft' ? 'draft' : 'audit'}</Link>.</>
                    : <>No follow-up yet — when {agentName} is audited next, the auditor can link that audit to this one.</>}
                </span>
              </div>
              {canFlag && !info.followedBy && <UnflagReauditButton auditId={audit.id} />}
            </>
          )}
          {(info.capaStatus === 'passed' || info.capaStatus === 'failed_again') && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge status={info.capaStatus} />
              {info.followedBy && (
                <span style={{ fontSize: '14px' }}>
                  <Link href={`/audits/${info.followedBy.id}`} style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>The follow-up audit</Link>{' '}
                  (<When r={info.followedBy} />){info.capaStatus === 'failed_again' ? ' — it can itself be flagged for another re-audit.' : '.'}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {showLinkOffer && (
        <div style={{ marginTop: showFollowsUp || showOwn ? '14px' : 0 }}>
          <div style={{ fontSize: '14px', marginBottom: '10px' }}>
            {agentName} has {info.linkable.length === 1 ? 'an audit' : `${info.linkable.length} audits`} waiting for a re-audit. Is this the follow-up?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {info.linkable.map((r) => (
              <div key={r.id} style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '13px' }}>
                  <Link href={`/audits/${r.id}`} style={{ color: 'var(--brand)', textDecoration: 'none' }}>Audit of <When r={r} /></Link>
                </span>
                <LinkReauditButton draftAuditId={audit.id} originalAuditId={r.id} label="Link this audit as the follow-up" />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
