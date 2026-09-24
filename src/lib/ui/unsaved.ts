// ============================================================
// Unsaved-changes registry (client-side).
// The scorecard already warns on closing the tab or refreshing
// (`beforeunload`) — but that event does NOT fire for in-app navigation:
// clicking a Next.js <Link> (a back link, the logo) just swaps the page and
// the unsaved scoring is gone. Anything with unsaved work registers here,
// and every in-app way out (BackLink, the header logo, Sign out) asks first.
// (The browser's own Back button is handled by the browser and can't be
// intercepted this way — saving before leaving is still the rule.)
// ============================================================

const dirty = new Set<string>()

/** Mark `key` as having (or no longer having) unsaved changes. Call with false on unmount. */
export function setUnsaved(key: string, isDirty: boolean): void {
  if (isDirty) dirty.add(key)
  else dirty.delete(key)
}

export function hasUnsaved(): boolean {
  return dirty.size > 0
}

export const LEAVE_MESSAGE = 'You have unsaved changes on this page. Leave without saving?'

/** True if it's fine to navigate away: nothing unsaved, or the user chose to leave anyway. */
export function confirmLeave(ask: (message: string) => boolean = (m) => window.confirm(m)): boolean {
  return !hasUnsaved() || ask(LEAVE_MESSAGE)
}
