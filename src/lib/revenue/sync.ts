// ============================================================
// SHIKHO QA SYSTEM — Daily revenue sync core (§8, Part C)
// Server-only. Pure orchestration: every side effect (CRM fetch, owner
// lookup, database) comes in through `deps`, so the rules below are
// unit-tested without the CRM or a database.
//
// Each run: fetch the whole trailing window (default 15 days, rolling),
// UPSERT it by crm_event_id — never delete-then-reinsert, so a failed
// re-fetch can never leave a gap — then flag (never delete) events that
// stopped appearing, then recompute weekly sales / Zero-Seller. Changes
// to anything inside the window apply silently: no approval, no notice.
//
// Guardrails (approved 2026-09-24):
//  1. Reuse a known agent for an owner already seen — no CRM lookup for
//     owners we've already resolved, and none for events already stored
//     with the same owner. Only genuinely NEW owner ids cost a lookup.
//  2. Never overwrite a matched agent on a failed / skipped lookup — a
//     timeout is not "no match". A failed lookup leaves a stored owner and
//     agent exactly as they were; retried next run.
//  3. recompute_weekly_sales() runs at the end; any failure is written to
//     revenue_sync_state ('error' / 'partial'), never swallowed.
// ============================================================

import { crmTimestamp, leadOwnerIdOf, mapEventToRow } from '../../../scripts/lib/revenue-mapping.mjs'
import type { CrmEvent } from '@/lib/crm/types'

export interface OwnerResolution {
  kind: 'matched' | 'unmatched' | 'failed'
  agentId?: string
}

export interface StoredRow {
  crm_event_id: number
  agent_id: string | null
  lead_owner_crm_id: number
}

export interface SyncStore {
  /** Stored rows created on/after `fromIso` (used to reuse owner->agent knowledge and detect owner changes). */
  loadWindowRows(fromIso: string): Promise<StoredRow[]>
  /** users.crm_agent_id -> users.id, for everyone who has one cached. */
  loadUserIdsByCrmId(): Promise<Map<number, string>>
  upsertRows(rows: Record<string, unknown>[]): Promise<void>
  /** flag_missing_revenue_events(): returns how many rows were newly flagged. */
  flagMissing(runStartedIso: string, windowFromIso: string): Promise<number>
  /**
   * recompute_weekly_sales(). `syncedThrough` is THIS run's start time when its window was fully fetched (null
   * otherwise): the recompute runs before the run records itself, so it must be told — that is the evidence that lets a
   * week be trusted once a successful sync has run after it ended (schema_030), instead of waiting for the next week's first sale.
   */
  recomputeWeeklySales(syncedThrough: string | null): Promise<unknown>
  writeState(patch: {
    watermark?: string | null
    events_synced?: number
    last_run_at: string
    last_run_status: 'ok' | 'error' | 'partial'
    last_run_note: string
    /** Start time of the last run whose window was FULLY fetched: everything the CRM created before it is loaded. Only ever set by such a run. */
    data_complete_through?: string
  }): Promise<void>
}

export interface SyncDeps {
  now(): Date
  sleep(ms: number): Promise<void>
  fetchPage(page: number, limit: number): Promise<CrmEvent[]>
  /** Resolve a CRM lead-owner id to one of our users — the app's existing matching pipeline. */
  resolveOwner(crmUserId: number, name: string | null): Promise<OwnerResolution>
  store: SyncStore
}

export interface SyncConfig {
  windowDays: number
  pageLimit: number
  /** If the last allowed page is still full, the window is incomplete. */
  maxPages: number
  /** Cap on brand-new owner lookups per run (each is a live CRM call). */
  maxNewOwnerLookups: number
  /** Stop doing owner lookups after this long, leaving time to finish (Vercel Hobby: 60s). */
  lookupDeadlineMs: number
  delayMs: number
  /** Missing-event flagging only looks this many days back — safely inside the fuzzy window edge. */
  flagWithinDays: number
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  windowDays: 15,
  pageLimit: 500,
  maxPages: 7,
  maxNewOwnerLookups: 25,
  lookupDeadlineMs: 40_000,
  delayMs: 800,
  flagWithinDays: 13,
}

export interface SyncResult {
  status: 'ok' | 'partial' | 'error'
  note: string
  fetched: number
  upserted: number
  skippedBadData: number
  ownerLookups: number
  ownerLookupsFailed: number
  newlyFlaggedMissing: number
  windowComplete: boolean
  recomputed: boolean
}

const DAY_MS = 86_400_000

export async function runRevenueSync(deps: SyncDeps, cfg: SyncConfig = DEFAULT_SYNC_CONFIG): Promise<SyncResult> {
  const started = deps.now()
  const startedIso = started.toISOString()
  const t0 = started.getTime()
  const fail = async (message: string): Promise<SyncResult> => {
    await deps.store.writeState({ last_run_at: deps.now().toISOString(), last_run_status: 'error', last_run_note: message })
    return {
      status: 'error', note: message, fetched: 0, upserted: 0, skippedBadData: 0, ownerLookups: 0,
      ownerLookupsFailed: 0, newlyFlaggedMissing: 0, windowComplete: false, recomputed: false,
    }
  }

  // 1 — fetch the WHOLE window before touching the database. An error here
  // leaves the database exactly as it was.
  const events: CrmEvent[] = []
  let windowComplete = false
  try {
    for (let page = 1; page <= cfg.maxPages; page++) {
      const batch = await deps.fetchPage(page, cfg.pageLimit)
      events.push(...batch)
      if (batch.length < cfg.pageLimit) {
        windowComplete = true
        break
      }
      await deps.sleep(cfg.delayMs)
    }
  } catch (err) {
    return fail(`Fetching the ${cfg.windowDays}-day window failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    // 2 — what we already know
    const storedFrom = new Date(t0 - (cfg.windowDays + 10) * DAY_MS).toISOString()
    const stored = await deps.store.loadWindowRows(storedFrom)
    const usersByCrmId = await deps.store.loadUserIdsByCrmId()
    const storedById = new Map(stored.map((r) => [Number(r.crm_event_id), r]))
    // owner -> agent as already resolved in stored rows (guardrail 1)
    const agentByOwner = new Map<number, string>()
    for (const r of stored) if (r.agent_id) agentByOwner.set(Number(r.lead_owner_crm_id), r.agent_id)
    const knownOwners = new Set(stored.map((r) => Number(r.lead_owner_crm_id)))
    const lookedUp = new Map<number, OwnerResolution>()

    let ownerLookups = 0
    let ownerLookupsFailed = 0
    let skippedBadData = 0

    // A known agent for this owner without any CRM call, or null.
    const knownAgent = (owner: number): string | undefined => usersByCrmId.get(owner) ?? agentByOwner.get(owner)

    const failedOwners = new Set<number>() // failed/skipped this run: don't re-ask for every event of the same owner

    async function resolveNewOwner(owner: number, name: string | null): Promise<OwnerResolution> {
      const cached = lookedUp.get(owner)
      if (cached) return cached
      if (failedOwners.has(owner)) return { kind: 'failed' }
      const overBudget = ownerLookups >= cfg.maxNewOwnerLookups || deps.now().getTime() - t0 > cfg.lookupDeadlineMs
      if (overBudget) {
        failedOwners.add(owner) // skipped, treated exactly like a failed lookup
        ownerLookupsFailed++
        return { kind: 'failed' }
      }
      if (ownerLookups > 0) await deps.sleep(cfg.delayMs)
      ownerLookups++
      let res: OwnerResolution
      try {
        res = await deps.resolveOwner(owner, name)
      } catch {
        res = { kind: 'failed' }
      }
      if (res.kind === 'failed') {
        ownerLookupsFailed++
        failedOwners.add(owner)
      } else {
        lookedUp.set(owner, res) // a settled answer is reused for the rest of the run
      }
      return res
    }

    // 3 — build rows
    const rows: Record<string, unknown>[] = []
    for (const event of events) {
      const owner = leadOwnerIdOf(event)
      const existing = storedById.get(Number(event.id))
      const name = event.lead_owner?.name ?? null

      let agentId: string | null = null
      let keepStoredOwner = false

      if (owner === null || owner === undefined) {
        agentId = existing?.agent_id ?? null
      } else if (existing && Number(existing.lead_owner_crm_id) === Number(owner)) {
        // Same owner as stored: keep the stored agent. Only upgrade an unmatched row
        // if we now KNOW the owner (roster grew / users.crm_agent_id cached) — free.
        agentId = existing.agent_id ?? knownAgent(owner) ?? null
      } else {
        // New event, or the CRM corrected the owner: resolve the (new) owner.
        const known = knownAgent(owner)
        if (known) {
          agentId = known
        } else if (knownOwners.has(owner) && !lookedUp.has(owner)) {
          // Owner already seen and stored as unmatched — don't re-ask the CRM every day.
          agentId = null
        } else {
          const res = await resolveNewOwner(owner, name)
          if (res.kind === 'matched') agentId = res.agentId ?? null
          else if (res.kind === 'unmatched') agentId = null
          else if (existing) {
            // Failed lookup on an owner CHANGE: never overwrite what we have with a guess.
            agentId = existing.agent_id
            keepStoredOwner = true
          } else {
            agentId = null // new event, lookup failed: stored unmatched now, healed by the rematch script
          }
        }
      }

      const mapped = mapEventToRow(event, agentId, () => startedIso)
      if (!mapped.row) {
        skippedBadData++
        continue
      }
      const row: Record<string, unknown> = { ...mapped.row }
      if (keepStoredOwner && existing) row.lead_owner_crm_id = existing.lead_owner_crm_id
      rows.push(row)
    }

    // 4 — upsert (never delete). Batches keep each request small.
    for (let i = 0; i < rows.length; i += 500) await deps.store.upsertRows(rows.slice(i, i + 500))

    // 5 — flag, don't delete: only after a COMPLETE fetch, only well inside the window.
    let newlyFlaggedMissing = 0
    if (windowComplete) {
      const flagFrom = new Date(t0 - cfg.flagWithinDays * DAY_MS).toISOString()
      newlyFlaggedMissing = await deps.store.flagMissing(startedIso, flagFrom)
    }

    // 6 — weekly sales / Zero-Seller. A failure here doesn't undo the sync; it's reported.
    let recomputed = true
    let recomputeError = ''
    try {
      await deps.store.recomputeWeeklySales(windowComplete ? startedIso : null)
    } catch (err) {
      recomputed = false
      recomputeError = err instanceof Error ? err.message : String(err)
    }

    const newest = events
      .map((e) => crmTimestamp(e.created_at))
      .filter((x): x is string => !!x)
      .sort()
      .at(-1)

    const problems: string[] = []
    if (!windowComplete) problems.push(`window NOT fully fetched (page ${cfg.maxPages} still full) — nothing flagged missing`)
    if (!recomputed) problems.push(`recompute_weekly_sales failed: ${recomputeError}`)
    if (ownerLookupsFailed > 0) problems.push(`${ownerLookupsFailed} owner lookup(s) failed/skipped — retried next run`)
    const status: SyncResult['status'] = !windowComplete || !recomputed ? 'partial' : 'ok'
    const note =
      `${events.length} fetched, ${rows.length} upserted, ${skippedBadData} skipped, ${ownerLookups} owner lookups, ` +
      `${newlyFlaggedMissing} newly flagged missing` + (problems.length ? ` | ${problems.join('; ')}` : '')

    await deps.store.writeState({
      watermark: newest ? new Date(newest).toISOString() : null,
      events_synced: rows.length,
      last_run_at: deps.now().toISOString(),
      last_run_status: status,
      last_run_note: note,
      // Set whenever the window was fully fetched — even if the recompute itself failed: the DATA is complete, and a later
      // standalone recompute may rely on that. Never set by an error or an incompletely-fetched run.
      ...(windowComplete ? { data_complete_through: startedIso } : {}),
    })
    return { status, note, fetched: events.length, upserted: rows.length, skippedBadData, ownerLookups, ownerLookupsFailed, newlyFlaggedMissing, windowComplete, recomputed }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
}
