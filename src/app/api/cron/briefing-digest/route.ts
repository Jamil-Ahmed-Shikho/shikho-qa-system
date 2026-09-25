import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runDailyBriefingDigest } from '@/lib/briefings/digest-runner'

// Briefings daily digest (§5 Part C). Vercel Cron calls this with GET and sends
// `Authorization: Bearer $CRON_SECRET`; the middleware lets /api/cron/* through
// (no Supabase session exists on a cron call), so THIS handler is the only gate —
// and it fails closed if the secret isn't set.
// Scheduled in vercel.json for 17:00 UTC = 23:00 Bangladesh. Hobby cron timing is
// only accurate to the hour (it may fire any time 17:00–17:59 UTC, still before
// midnight Dhaka), and it is the SECOND of Hobby's two cron jobs.
//
// SAFE BY DEFAULT: unless BRIEFING_DIGEST_MODE is set to preview / test / live this
// does nothing at all — see digest-runner.ts. Deploying it cannot email anyone.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 })
  }
  if (!authorised(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

  try {
    const result = await runDailyBriefingDigest()
    if (result.failed.length > 0) console.error('Briefing digest: some sends failed', result.failed)
    return NextResponse.json(result, { status: result.failed.length > 0 && result.sent === 0 ? 500 : 200 })
  } catch (err) {
    console.error('Briefing digest crashed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Digest crashed.' }, { status: 500 })
  }
}
