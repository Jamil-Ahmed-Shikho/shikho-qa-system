#!/usr/bin/env node
// ============================================================
// SHIKHO QA AUDIT MANAGEMENT SYSTEM
// One-time historical revenue backfill (§8, sub-step B)
//
// STANDALONE — deliberately NOT part of the deployed Next.js app (no
// Vercel timeout, no build step needed). Run by hand, from a machine with
// this repo checked out and a valid .env.local:
//
//   node --env-file=.env.local scripts/backfill-revenue.mjs --pages=1
//     Dry run, 1 page, a SMALL page size (10 events — see --page-limit
//     below). Fetches real CRM data, prints a summary, writes NOTHING to
//     Supabase. Use this first, as a cheap live smoke test, before
//     trusting the field mapping or the agent-match rate. Per-event agent
//     matching can add one extra live CRM request per unmatched
//     lead_owner, so keep dry runs small on purpose — a full 500-row
//     page with a low match rate can mean several hundred CRM requests,
//     which is NOT a "cheap smoke test" any more (learned this the hard
//     way testing this script: a --page-limit=500 dry run took ~2 minutes
//     and made ~500 live CRM requests for what was meant to be a quick
//     check).
//
//   node --env-file=.env.local scripts/backfill-revenue.mjs --live
//     The real run. Requires --live explicitly — there is no default
//     "just run it" mode. Per the agreed operational plan: only run this
//     by hand, during the 9 PM-5 AM Bangladesh-time low-traffic window,
//     in one sitting, with you present and watching. Never schedule or
//     automate this invocation.
//
// Flags:
//   --live            Actually write to Supabase and advance
//                      revenue_sync_state. Omit for a dry run.
//   --pages=N          Stop after N pages this invocation (both modes).
//                      Omit to run to completion (the 12-month cutoff).
//   --page-limit=N      CRM page size (the `limit=` query param). Defaults
//                      to 10 for a dry run (cheap smoke tests) and 500
//                      for --live (the real, CRM-accepted max). Override
//                      explicitly either way.
//   --delay-ms=N        Override the default delay between CRM requests
//                      (default 800ms — see the "request delay" open
//                      question in CLAUDE.md §8; adjust here, not by
//                      editing this file, once a real number is confirmed).
//
// What it does
//   Pages the CRM's /events list DESCENDING (newest -> oldest; the
//   already-proven direction — see the header note on pagination
//   direction below for why the backfill uses this too, not ascending),
//   for both type:shikho_purchase_completed and type:installment_enrollment
//   (confirmed in scope — each installment event attributes independently
//   to whoever owned the lead at that moment; never merged to one
//   "original" salesperson — CLAUDE.md §8), stopping once a full page's
//   oldest event falls before the 12-month cutoff. Every event is mapped
//   straight from the LIST response — no per-event detail fetch, ever
//   (confirmed: list and detail are byte-identical for custom_field).
//
// Pagination direction — why DESCENDING, not ascending as first sketched
//   The original sketch (CLAUDE.md, before "12 months only" was added)
//   had the backfill page ASCENDING specifically so a checkpoint (a page
//   number) would stay valid across a long, possibly unattended,
//   multi-day run: new sales append at the END under ascending order, so
//   already-fetched low page numbers never shift.
//   That reasoning assumed an unbounded backfill (walk everything, however
//   long it takes). Once scope narrowed to "last 12 months only" (this
//   round), ascending stopped making sense: there is still no confirmed
//   date-range query operator, so ascending order has no way to START at
//   the 12-months-ago boundary — it would have to page from the CRM's
//   entire event history from day one, burning potentially tens of
//   thousands of requests just to reach the window that matters, which is
//   exactly the cost this design was meant to avoid.
//   Descending naturally solves this: start at today, stop the moment a
//   page is entirely older than the cutoff. It also reuses the ONE
//   direction actually proven live (the daily sync's), rather than an
//   untested one. Its own downside — a new sale during the run shifts
//   page *positions* for a page-number-based resume — matters far less
//   here than in the original long-running design: this run is a single
//   supervised sitting of minutes, not days, every write is an idempotent
//   upsert keyed on crm_event_id (so replaying a page is always safe),
//   and a full restart is cheap (a few hundred requests, not thousands).
//   So revenue_sync_state.cursor_page is kept as a courtesy resume point
//   for a crash mid-run, not a correctness requirement — if in doubt,
//   just rerun from page 1; nothing double-counts.
//
// Agent matching — same algorithm as the app, deliberately reimplemented
//   here rather than imported. src/lib/audits/agent-matching.ts and
//   src/lib/crm/client.ts are written for Next.js (next/headers,
//   @supabase/ssr's cookie-bound client, React's cache()) and aren't a
//   clean fit for a bare Node script. The STEPS are identical on purpose
//   (users.crm_agent_id first, else GET /users/{id} -> email ->
//   users.email, then cache crm_agent_id) — if that algorithm ever
//   changes there, mirror the change here too.
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { mapEventToRow, pageIsBeforeCutoff, monthsAgo, leadOwnerIdOf } from './lib/revenue-mapping.mjs'

// ── config ───────────────────────────────────────────────────
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  })
)
const LIVE = args.has('live')
const PAGE_CAP = args.has('pages') ? Number(args.get('pages')) : Infinity
const REQUEST_DELAY_MS = args.has('delay-ms') ? Number(args.get('delay-ms')) : 800
// A dry run defaults to a SMALL page size (not the real 500) so a smoke
// test costs a handful of CRM requests, not hundreds — per-event agent
// matching can trigger one extra CRM call per unmatched lead_owner, which
// dominates cost far more than the /events pagination itself does.
// --page-limit overrides this explicitly (also usable in --live mode).
const PAGE_LIMIT = args.has('page-limit') ? Number(args.get('page-limit')) : LIVE ? 500 : 10
const BACKFILL_MONTHS = 12
const EVENT_TYPES = 'shikho_purchase_completed,installment_enrollment'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

const CRM_API_BASE = requireEnv('CRM_API_BASE').replace(/\/$/, '').replace(/\/api\/v1$/, '')
const CRM_BEARER_TOKEN = requireEnv('CRM_BEARER_TOKEN')
// Needed even in a dry run — agent matching reads `users` (and, in LIVE
// mode only, caches crm_agent_id back onto it). Nothing else writes
// without --live; see resolveAgentId() and upsertSyncState() below.
const supabase = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})

// ── CRM client (mirrors src/lib/crm/client.ts) ──────────────
function buildLogRefId(now = Date.now()) {
  return `shikho-qa-backfillscript-${now}`
}

async function crmFetch(path) {
  const res = await fetch(`${CRM_API_BASE}/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${CRM_BEARER_TOKEN}`,
      Accept: 'application/json',
      'X-Log-Ref-Id': buildLogRefId(),
    },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`CRM API ${res.status} on ${path}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

async function getEventsPage(page) {
  const q =
    `?search=type:${EVENT_TYPES}` +
    `&conditions=type:in&join=and&page=${page}&limit=${PAGE_LIMIT}` +
    `&orderBy=created_at&sortedBy=desc`
  const body = await crmFetch(`/events${q}`)
  return body.data ?? []
}

async function getCrmUserEmail(crmUserId) {
  try {
    const raw = await crmFetch(`/users/${crmUserId}`)
    const email = typeof raw?.email === 'string' && raw.email.trim() ? raw.email.trim().toLowerCase() : null
    return email
  } catch (err) {
    console.error('  CRM user lookup failed for', crmUserId, ':', err.message)
    return null
  }
}

// ── agent matching (mirrors matchUser() in agent-matching.ts) ─
const matchCache = new Map() // crm lead_owner id -> users.id | null

async function resolveAgentId(leadOwnerId) {
  if (matchCache.has(leadOwnerId)) return matchCache.get(leadOwnerId)

  const { data: byCrmId } = await supabase
    .from('users')
    .select('id')
    .eq('crm_agent_id', leadOwnerId)
    .maybeSingle()
  if (byCrmId) {
    matchCache.set(leadOwnerId, byCrmId.id)
    return byCrmId.id
  }

  await sleep(REQUEST_DELAY_MS) // this is an extra live CRM request — throttle it too
  const email = await getCrmUserEmail(leadOwnerId)
  if (!email) {
    matchCache.set(leadOwnerId, null)
    return null
  }

  const { data: byEmail } = await supabase.from('users').select('id, crm_agent_id').eq('email', email).maybeSingle()
  if (!byEmail) {
    matchCache.set(leadOwnerId, null)
    return null
  }

  if (byEmail.crm_agent_id === null && LIVE) {
    await supabase.from('users').update({ crm_agent_id: leadOwnerId }).eq('id', byEmail.id).is('crm_agent_id', null)
  }

  matchCache.set(leadOwnerId, byEmail.id)
  return byEmail.id
}

// ── event -> row mapping (pure logic lives in lib/revenue-mapping.mjs) ─
/** Returns null (and logs why) for an event that shouldn't be written — never throws on bad data. */
async function buildRow(event) {
  const leadOwnerId = leadOwnerIdOf(event)
  const agentId = leadOwnerId !== null && leadOwnerId !== undefined ? await resolveAgentId(leadOwnerId) : null
  const result = mapEventToRow(event, agentId)
  if (result.skipped) {
    console.warn('  skipping event', event.id, '-', result.skipped)
    return null
  }
  return result.row
}

// ── revenue_sync_state ───────────────────────────────────────
async function loadSyncState() {
  const { data, error } = await supabase.from('revenue_sync_state').select('*').eq('id', 'backfill').maybeSingle()
  if (error) throw new Error(`Reading revenue_sync_state failed: ${error.message}`)
  return data
}

async function upsertSyncState(patch) {
  if (!LIVE) return
  const { error } = await supabase.from('revenue_sync_state').upsert({ id: 'backfill', ...patch })
  if (error) throw new Error(`Writing revenue_sync_state failed: ${error.message}`)
}

// ── main ─────────────────────────────────────────────────────
async function main() {
  console.log(LIVE ? '=== LIVE RUN — writing to Supabase ===' : '=== DRY RUN — no writes ===')
  console.log('page cap this invocation:', PAGE_CAP === Infinity ? '(none — runs to completion)' : PAGE_CAP)
  console.log('request delay:', REQUEST_DELAY_MS, 'ms')

  const state = await loadSyncState()
  let page = LIVE && state?.cursor_page ? state.cursor_page : 1
  if (page > 1) console.log(`resuming from page ${page} (revenue_sync_state.cursor_page)`)

  const cutoff = monthsAgo(BACKFILL_MONTHS)
  console.log('12-month cutoff:', cutoff.toISOString().slice(0, 10))

  let totalEvents = 0,
    totalWritten = 0,
    totalMatched = 0,
    totalSkipped = 0,
    pagesThisRun = 0

  try {
    while (pagesThisRun < PAGE_CAP) {
      const events = await getEventsPage(page)
      pagesThisRun++
      if (events.length === 0) {
        console.log(`page ${page}: empty — reached the end of the CRM's event history`)
        break
      }

      const rows = []
      for (const event of events) {
        totalEvents++
        const row = await buildRow(event)
        if (row) {
          rows.push(row)
          if (row.agent_id) totalMatched++
        } else {
          totalSkipped++
        }
      }

      if (LIVE && rows.length > 0) {
        const { error } = await supabase.from('agent_revenue_transactions').upsert(rows, { onConflict: 'crm_event_id' })
        if (error) throw new Error(`Upsert failed on page ${page}: ${error.message}`)
      }
      totalWritten += rows.length

      const oldestOnPage = events[events.length - 1].created_at
      console.log(
        `page ${page}: ${events.length} events, oldest ${oldestOnPage.slice(0, 10)}` +
          ` — ${rows.length} ${LIVE ? 'written' : 'would be written'}, ${totalMatched} matched so far`
      )

      await upsertSyncState({
        cursor_page: page,
        events_synced: totalWritten,
        last_run_at: new Date().toISOString(),
        last_run_status: 'partial',
        last_run_note: `page ${page}, ${totalWritten} written so far`,
      })

      if (pageIsBeforeCutoff(oldestOnPage, cutoff)) {
        console.log(`page ${page}'s oldest event is before the ${BACKFILL_MONTHS}-month cutoff — stopping`)
        break
      }

      page++
      await sleep(REQUEST_DELAY_MS)
    }

    await upsertSyncState({
      cursor_page: page,
      events_synced: totalWritten,
      last_run_at: new Date().toISOString(),
      last_run_status: pagesThisRun >= PAGE_CAP ? 'partial' : 'ok',
      last_run_note: `finished: ${totalEvents} events seen, ${totalWritten} written, ${totalMatched} matched, ${totalSkipped} skipped`,
    })
  } catch (err) {
    await upsertSyncState({
      cursor_page: page,
      last_run_at: new Date().toISOString(),
      last_run_status: 'error',
      last_run_note: err.message,
    })
    throw err
  }

  console.log('\n=== summary ===')
  console.log('pages fetched this invocation:', pagesThisRun)
  console.log('events seen:', totalEvents)
  console.log(LIVE ? 'rows written:' : 'rows that WOULD be written:', totalWritten)
  console.log('matched to an agent:', totalMatched, `(${totalEvents ? ((totalMatched / totalEvents) * 100).toFixed(1) : 0}%)`)
  console.log('skipped (bad data):', totalSkipped)
  if (!LIVE) console.log('\nThis was a dry run — nothing was written. Pass --live to write for real.')
}

main().catch((err) => {
  console.error('\nFATAL:', err.message)
  process.exit(1)
})
