import type { CoachingHistoryItem } from './briefings.service'

/**
 * Splits an agent's coaching history into what's still coming and what
 * already happened (or should have). A "scheduled" session whose time has
 * passed counts as past — its attendance just hasn't been recorded yet.
 * Upcoming: soonest first. Past: most recent first.
 */
export function splitHistory(items: CoachingHistoryItem[], now: Date = new Date()) {
  const isUpcoming = (h: CoachingHistoryItem) => h.status === 'scheduled' && new Date(h.scheduledAt) > now
  const upcoming = items
    .filter(isUpcoming)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
  const past = items
    .filter((h) => !isUpcoming(h))
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
  return { upcoming, past }
}
