import { NextRequest, NextResponse } from 'next/server'
import { recordAuditResultView, verifyAuditViewToken } from '@/lib/audits/view-tracking'

// ============================================================
// The evaluation email's "I've seen this" button (and its portal link) land here FIRST, not
// directly on /my-audits/{id} — a real click is the trustworthy signal
// (§ view-tracking.ts). No login is required to hit this route (the agent
// may not have an activated account yet, §2) — recording a click never
// depends on, or waits for, authentication. Always redirects on to the
// real result page afterward, whether or not the click was recorded, so a
// broken/old link never leaves the agent stuck.
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const dest = new URL(`/my-audits/${id}`, req.url)

  if (!UUID_RE.test(id)) return NextResponse.redirect(dest)

  const token = req.nextUrl.searchParams.get('t') ?? ''
  if (verifyAuditViewToken(id, token)) {
    try {
      await recordAuditResultView(id)
    } catch (err) {
      // Never block the agent from reaching their result because tracking failed.
      console.error('recordAuditResultView failed:', err)
    }
  }

  return NextResponse.redirect(dest)
}
