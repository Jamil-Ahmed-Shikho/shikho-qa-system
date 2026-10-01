'use server'
// ============================================================
// SHIKHO QA SYSTEM — notification server actions, callable directly from
// the client NotificationBell component. Return plain data / {ok,error}
// (§14) — a failed load throws here so the bell can show "could not load"
// rather than a silently-empty bell (§14's own "never let a failed read
// look like nothing to show").
// ============================================================

import {
  countUnreadNotifications,
  loadMyNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  type NotificationItem,
} from './notifications.service'

export async function loadNotificationsAction(): Promise<{ ok: true; items: NotificationItem[]; unread: number } | { ok: false; error: string }> {
  try {
    const items = await loadMyNotifications()
    return { ok: true, items, unread: items.filter((n) => !n.readAt).length }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not load notifications.' }
  }
}

export async function markNotificationsReadAction(ids: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await markNotificationsRead(ids)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update notifications.' }
  }
}

export async function markAllNotificationsReadAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await markAllNotificationsRead()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update notifications.' }
  }
}

// Unused directly by the client (loadNotificationsAction already returns the count), kept for any
// future caller that wants the badge count alone without the full list.
export async function countUnreadNotificationsAction(): Promise<number> {
  try {
    return await countUnreadNotifications()
  } catch {
    return 0
  }
}
