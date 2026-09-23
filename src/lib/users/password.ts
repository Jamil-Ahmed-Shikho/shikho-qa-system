// ============================================================
// SHIKHO QA SYSTEM — Temporary password generation
// Server-only. Uses crypto.randomInt (CSPRNG) — Math.random is not
// suitable for credentials.
// ============================================================

import { randomInt } from 'node:crypto'

// Ambiguous characters (0/O, 1/l/I) removed so it can be typed from an email.
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

export function generateTempPassword(length = 12): string {
  return Array.from({ length }, () => CHARS[randomInt(CHARS.length)]).join('')
}
