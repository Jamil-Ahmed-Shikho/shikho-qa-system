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
//   --before-id=N        Start from events with id below N instead of the
//                      resume point (default: a live run resumes from the
//                      lowest event id already stored, plus an overlap;
//                      empty table = newest).
//   --resume            Make a DRY run start from that same resume point.
//   --delay-ms=N        Override the default delay between CRM requests
//                      (default 800ms — see the "request delay" open
//                      question in CLAUDE.md §8; adjust here, not by
//                      editing this file, once a real number is confirmed).
//
// What it does
//   Pages the CRM's /events list newest -> oldest by an event-ID cursor (see the
//   pagination note below),
//   for both type:shikho_purchase_completed and type:installment_enrollment
//   (confirmed in scope — each installment event attributes independently
//   to whoever owned the lead at that moment; never merged to one
//   "original" salesperson — CLAUDE.md §8), stopping once a full page's
//   NEWEST event is a week before the 12-month cutoff. Every event is mapped
//   straight from the LIST response — no per-event detail fetch, ever
//   (confirmed: list and detail are byte-identical for custom_field).
//
// Pagination — an event-ID CURSOR, not page numbers
//   Newest -> oldest, always requesting page=1 and moving an id cursor:
//   orderBy=id&sortedBy=desc with search=...;id:N and conditions=...;id:<
//   (only events with id < N); each step's cursor is the lowest id on the
//   previous page. The cursor is exact — no day-granularity boundary.
//   Why not page numbers: on the first live run, pages 1-7 (500 rows each)
//   were fine but page 8 timed out on every attempt (30s x 4); ordering by
//   id did NOT fix that (page 8 by id also timed out at 45s) — it is the
//   OFFSET that is slow. Why id rather than a created_at cursor (both
//   measured, read-only): at the stored boundary 3.2s (id) vs 3.8s (date);
//   about six months back 0.8s (id) vs 7.9s (date) — the date cursor slows
//   as it goes deeper, the id cursor does not, which matters over a
//   12-month traversal.
//   IDs do not track creation time perfectly (~1.1% of events are
//   back-dated relative to id order, worst case measured 5.5 days), so:
//   the STOP rule waits for a page whose NEWEST event is STOP_MARGIN_DAYS
//   before the cutoff, and RESUME starts ID_RESUME_OVERLAP above the lowest
//   stored id so back-dated events just above it are re-fetched (upserts
//   make the overlap harmless). This affects only TRAVERSAL: which week an
//   event belongs to is decided by its created_at, stored as-is.
//   Resume point = the lowest crm_event_id already in
//   agent_revenue_transactions (the table is the source of truth), or
//   --before-id=N. revenue_sync_state.watermark records the oldest
//   created_at reached, for inspection. The cursor must strictly decrease;
//   if it doesn't, the script stops with an error instead of looping.
//
// Timestamps: the CRM's created_at/updated_at are zoneless Dhaka local
//   time; crmTimestamp() (lib/revenue-mapping.mjs) pins them to +06:00.
//   Run supabase/fix_001_crm_timestamps_dhaka.sql ONCE before resuming, to
//   correct the rows the first run stored as if they were UTC.
//
// Requires schema_023 (last_seen_at / missing_from_crm_since) applied first.
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
import { mapEventToRow, monthsAgo, leadOwnerIdOf, crmTimestamp, nextOldPageStreak } from './lib/revenue-mapping.mjs'

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
// Event ids do NOT track creation time exactly: measured on 3,500 loaded rows,
// ~1.1% of events were created earlier than an event with a LOWER id (mostly
// 6-24h, worst 5.5 days). Two consequences, both handled with these margins:
//  - STOP only once a page's NEWEST created_at is this far before the cutoff
//    (a lower id can carry a later date by up to ~5.5 days).
//  - RESUME from stored min id + ID_RESUME_OVERLAP, so back-dated events whose
//    id sits just above what date-ordered paging already loaded are re-fetched
//    (ids run ~45k/day across all event types; 400k ~ 9 days). Overlap is
//    harmless — every write is an upsert on crm_event_id.
const STOP_MARGIN_DAYS = 7
// ...and only after this many CONSECUTIVE such pages (a bulk import of old-dated events can fill a page or two).
const STOP_CONSECUTIVE_PAGES = 5
const ID_RESUME_OVERLAP = 400000

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

// Retries only transient failures (timeout / network / 5xx) with a growing
// pause, so one slow response doesn't end a supervised run. 4xx (e.g. an
// expired token) fails immediately — retrying those only adds CRM load.
async function crmFetch(path, attempt = 1) {
  try {
    const res = await fetch(`${CRM_API_BASE}/api/v1${path}`, {
      headers: {
        Authorization: `Bearer ${CRM_BEARER_TOKEN}`,
        Accept: 'application/json',
        'X-Log-Ref-Id': buildLogRefId(),
      },
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const err = new Error(`CRM API ${res.status} on ${path}: ${body.slice(0, 300)}`)
      err.transient = res.status >= 500
      throw err
    }
    return await res.json()
  } catch (err) {
    const transient = err.transient === undefined ? true : err.transient // timeouts/network errors carry no flag
    if (transient && attempt < 4) {
      const wait = attempt * 5000
      console.warn(`  CRM request failed (${err.message}) — retry ${attempt}/3 in ${wait / 1000}s`)
      await sleep(wait)
      return crmFetch(path, attempt + 1)
    }
    throw err
  }
}

// Always page=1: progress comes from an ID cursor, never an increasing page
// number (offset paging times out at depth, whatever the sort key — measured).
// beforeId = only events with id < beforeId, newest id first; null = start
// from the newest event.
async function getEventsBeforeId(beforeId) {
  const filter = beforeId ? `;id:${beforeId}` : ''
  const cond = beforeId ? ';id:<' : ''
  const q =
    `?search=type:${EVENT_TYPES}${filter}` +
    `&conditions=type:in${cond}&join=and&page=1&limit=${PAGE_LIMIT}` +
    `&orderBy=id&sortedBy=desc`
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

  // Where to start. --before-id=N wins; otherwise a live run (or a dry run
  // with --resume) picks up from the lowest event id already stored, plus
  // ID_RESUME_OVERLAP — the table itself is the source of truth for "how far
  // did we get", so this stays correct even if revenue_sync_state was left
  // mid-write. (The overlap re-fetches back-dated events; see the constants.)
  let cursor = null
  if (args.has('before-id')) {
    cursor = Number(args.get('before-id'))
  } else if (LIVE || args.has('resume')) {
    const { data: lowest, error } = await supabase
      .from('agent_revenue_transactions')
      .select('crm_event_id')
      .order('crm_event_id', { ascending: true })
      .limit(1)
    if (error) throw new Error(`Reading the resume point failed: ${error.message}`)
    if (lowest?.length) cursor = Number(lowest[0].crm_event_id) + ID_RESUME_OVERLAP
  }
  console.log(cursor ? `resuming: events with id < ${cursor} (overlap with already-stored rows is intentional)` : 'starting from the newest event')

  const cutoff = monthsAgo(BACKFILL_MONTHS)
  console.log('12-month cutoff:', cutoff.toISOString().slice(0, 10), `(events older than it are not stored; stops after ${STOP_CONSECUTIVE_PAGES} consecutive pages whose newest event is ${STOP_MARGIN_DAYS}+ days before it)`)

  let totalEvents = 0,
    totalWritten = 0,
    totalMatched = 0,
    totalSkipped = 0,
    totalOutOfScope = 0,
    oldPageStreak = 0,
    pagesThisRun = 0,
    page = 0

  try {
    while (pagesThisRun < PAGE_CAP) {
      const events = await getEventsBeforeId(cursor)
      pagesThisRun++
      page = pagesThisRun
      if (events.length === 0) {
        console.log(`request ${page}: empty — reached the end of the CRM's event history`)
        break
      }

      const rows = []
      for (const event of events) {
        totalEvents++
        // Out of scope (older than 12 months, e.g. a bulk import of old-dated events): not stored, and not worth an owner lookup.
        const createdAt = crmTimestamp(event.created_at)
        if (createdAt && new Date(createdAt) < cutoff) { totalOutOfScope++; continue }
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

      // Normalised first: the raw strings are 12-hour ('… 08:13:30 pm') and don't sort by time.
      const dates = events.map((e) => crmTimestamp(e.created_at)).filter(Boolean).sort()
      const oldestOnPage = dates[0]
      const newestOnPage = dates[dates.length - 1]
      const nextCursor = Math.min(...events.map((e) => Number(e.id)))
      console.log(
        `page ${page}: ${events.length} events, created ${oldestOnPage.slice(0, 10)}..${newestOnPage.slice(0, 10)}` +
          ` — ${rows.length} ${LIVE ? 'written' : 'would be written'}, ${totalMatched} matched so far`
      )

      await upsertSyncState({
        watermark: new Date(oldestOnPage).toISOString(),
        events_synced: totalWritten,
        last_run_at: new Date().toISOString(),
        last_run_status: 'partial',
        last_run_note: `request ${page}, next cursor id < ${nextCursor}, ${totalWritten} written this run`,
      })

      // Stop rule for id order: a lower id can carry a LATER date (back-dated
      // events, up to ~5.5 days measured), so only stop once even the
      // newest event on the page is well before the cutoff.
      oldPageStreak = nextOldPageStreak(oldPageStreak, newestOnPage, new Date(cutoff.getTime() - STOP_MARGIN_DAYS * 86400000))
      if (oldPageStreak > 0) console.log(`  (page ${page}: newest event is before the cutoff — ${oldPageStreak}/${STOP_CONSECUTIVE_PAGES} in a row)`)
      if (oldPageStreak >= STOP_CONSECUTIVE_PAGES) {
        console.log(`request ${page}: ${STOP_CONSECUTIVE_PAGES} consecutive pages entirely before the ${BACKFILL_MONTHS}-month cutoff — stopping`)
        break
      }

      // The cursor must strictly decrease, or we'd refetch the same page forever.
      if (cursor && nextCursor >= cursor) {
        throw new Error(`Cursor did not advance (id ${cursor} -> ${nextCursor}). Stopping instead of looping the CRM.`)
      }
      cursor = nextCursor
      await sleep(REQUEST_DELAY_MS)
    }

    await upsertSyncState({
      events_synced: totalWritten,
      last_run_at: new Date().toISOString(),
      last_run_status: pagesThisRun >= PAGE_CAP ? 'partial' : 'ok',
      last_run_note: `finished: ${totalEvents} events seen, ${totalWritten} written, ${totalMatched} matched, ${totalSkipped} skipped, ${totalOutOfScope} older than the cutoff (not stored)`,
    })
  } catch (err) {
    await upsertSyncState({
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
  console.log('older than the 12-month cutoff (not stored):', totalOutOfScope)
  if (!LIVE) console.log('\nThis was a dry run — nothing was written. Pass --live to write for real.')
}

main().catch((err) => {
  console.error('\nFATAL:', err.message)
  process.exit(1)
})
