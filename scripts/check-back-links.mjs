#!/usr/bin/env node
// ============================================================
// Back-navigation check. Fails (exit 1) if:
//   1. a page that ISN'T a home/auth page has no <BackLink> (directly, or in
//      a component it imports), so a new page can't quietly ship as a dead end;
//   2. a hand-built "←" back link exists anywhere except the BackLink
//      component itself (so wording/behaviour stay consistent and the
//      unsaved-changes guard isn't bypassed).
//
//   node scripts/check-back-links.mjs      (or: npm run check:nav)
//
// Home pages need no back link: the role dashboards and the auth pages
// (the forced password change is a one-way step, by design).
// ============================================================
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const app = join(root, 'src', 'app')
const EXEMPT = [/^page\.tsx$/, /^dashboard\//, /^auth\//] // paths relative to src/app, always with forward slashes

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const read = (p) => readFileSync(p, 'utf8')

function resolveImport(spec) {
  if (!spec.startsWith('@/')) return null
  const base = join(root, 'src', spec.slice(2))
  for (const ext of ['.tsx', '.ts', '/index.tsx']) if (existsSync(base + ext)) return base + ext
  return null
}

const problems = []
let checked = 0

for (const file of walk(app).filter((f) => f.endsWith(`${sep}page.tsx`))) {
  const rel = relative(app, file).split(sep).join('/')
  if (EXEMPT.some((re) => re.test(rel))) continue
  checked++
  const src = read(file)
  const uses = (s) => s.includes('<BackLink')
  let ok = uses(src)
  if (!ok) {
    for (const m of src.matchAll(/from '(@\/[^']+)'/g)) {
      const p = resolveImport(m[1])
      if (p && uses(read(p))) { ok = true; break }
    }
  }
  if (!ok) problems.push(`no <BackLink> on /${rel.replace(/\/?page\.tsx$/, '')}  (src/app/${rel})`)
}

for (const file of walk(join(root, 'src')).filter((f) => /\.tsx$/.test(f))) {
  if (file.endsWith(`${sep}BackLink.tsx`)) continue
  const lines = read(file).split('\n')
  lines.forEach((l, i) => {
    if (l.includes('←') && !l.trim().startsWith('//') && !l.trim().startsWith('*')) {
      problems.push(`hand-built "←" link — use <BackLink>: ${relative(root, file)}:${i + 1}`)
    }
  })
}

if (problems.length) {
  console.error('Back-navigation check FAILED:\n  - ' + problems.join('\n  - '))
  process.exit(1)
}
console.log(`Back-navigation check passed: ${checked} pages have a BackLink, no hand-built back links.`)
