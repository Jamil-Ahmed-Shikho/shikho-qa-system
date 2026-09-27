import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runDailyRevenueSync } from '@/lib/revenue/sync-runner'
import { runAgentStatusCompute } from '@/lib/status/status-runner'
import { runWeeklyTargetCompute } from '@/lib/queue/targets-runner'

// Daily revenue sync (§8 Part C). Vercel Cron calls this with GET and sends
// `Authorization: Bearer $CRON_SECRET`; the middleware lets /api/cron/*
// through because no Supabase session exists on a cron call, so THIS
// handler is the only gate — and it fails closed if the secret isn't set.
// Scheduled in vercel.json for 22:00 UTC (04:00 Bangladesh, the quiet
// window). Hobby allows at most 60s and one run per day.
// It ALSO refreshes the weekly agent Red/Yellow/Green status (§6.2) after the
// sync — the same job, because Hobby allows only two cron jobs in total and
// the Briefings digest needs the second. The two are independent: a sync
// failure never skips the status run, and vice versa.
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
    // Status first: it reads only audits (fast, no CRM), so a slow or crashing
    // CRM sync can never starve it. It never throws (errors come back in the result).
    const agentStatus = await runAgentStatusCompute()
    if (!agentStatus.ok) console.error('Agent status computation failed:', agentStatus.error)
    // Then this week's audit targets (§9): reads the status just computed for the +1 bonus. Never throws.
    const auditTargets = await runWeeklyTargetCompute()
    if (!auditTargets.ok) console.error('Weekly audit target computation failed:', auditTargets.error)
    const result = await runDailyRevenueSync()
    return NextResponse.json({ ...result, agentStatus, auditTargets }, { status: result.status === 'error' ? 500 : 200 })
  } catch (err) {
    // runRevenueSync records its own failures in revenue_sync_state; this is
    // only reached if it couldn't even start (e.g. missing env vars).
    console.error('Revenue sync crashed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync crashed.' }, { status: 500 })
  }
}
