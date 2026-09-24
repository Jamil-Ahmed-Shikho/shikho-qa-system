import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runDailyRevenueSync } from '@/lib/revenue/sync-runner'

// Daily revenue sync (§8 Part C). Vercel Cron calls this with GET and sends
// `Authorization: Bearer $CRON_SECRET`; the middleware lets /api/cron/*
// through because no Supabase session exists on a cron call, so THIS
// handler is the only gate — and it fails closed if the secret isn't set.
// Scheduled in vercel.json for 22:00 UTC (04:00 Bangladesh, the quiet
// window). Hobby allows at most 60s and one run per day.
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
    const result = await runDailyRevenueSync()
    return NextResponse.json(result, { status: result.status === 'error' ? 500 : 200 })
  } catch (err) {
    // runRevenueSync records its own failures in revenue_sync_state; this is
    // only reached if it couldn't even start (e.g. missing env vars).
    console.error('Revenue sync crashed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync crashed.' }, { status: 500 })
  }
}
