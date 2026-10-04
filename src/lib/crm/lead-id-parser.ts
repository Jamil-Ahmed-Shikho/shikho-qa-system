// ============================================================
// SHIKHO QA SYSTEM — Lead ID / URL parser (§10 step 1)
// Pure function — no I/O, safe to import from client or server code.
// ============================================================

/**
 * Accepts either a bare lead ID ("12345") or a full lead URL
 * ("crm.shikho.com/details/lead/12345", with or without protocol/query
 * string) and returns the numeric lead ID, or null if nothing
 * usable was found.
 */
export function parseLeadIdentifier(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Bare numeric ID.
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed)
  }

  // URL shape: take the numeric path segment right after "lead/" (matches
  // both the real "details/lead/12345" route and an older "leads/12345" paste).
  const urlMatch = trimmed.match(/\/leads?\/(\d+)(?:[/?#]|$)/i)
  if (urlMatch) {
    return Number(urlMatch[1])
  }

  // Last resort: any run of digits in the string (handles a pasted
  // fragment that isn't a clean URL or a clean ID).
  const looseMatch = trimmed.match(/(\d+)/)
  if (looseMatch) {
    return Number(looseMatch[1])
  }

  return null
}

/** The CRM web app's real lead page — confirmed by Jamil 2026-10-04 (the earlier
 * "crm.shikho.com/leads/{id}" guess 404'd; this is the actual route). */
export function crmLeadUrl(leadId: string | number): string {
  return `https://crm.shikho.com/details/lead/${leadId}`
}
