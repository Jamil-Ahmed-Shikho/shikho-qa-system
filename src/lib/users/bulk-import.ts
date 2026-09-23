// ============================================================
// SHIKHO QA SYSTEM — Bulk user import (Excel)
// Server-only (ExcelJS pulls in Node-only dependencies — never import
// this from a client component). Uses exceljs, not xlsx (unpatched
// CVEs — CLAUDE.md §14).
//
// Flow: template → fill → upload → validate every row → create Auth
// account + profile → link supervisors → email a temporary password.
// Supervisors are referenced by email, so a Team Leader can appear
// earlier in the same file as the agents who report to them.
// ============================================================

import ExcelJS from 'exceljs'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { TEAM_NAMES } from '@/types/database.types'
import type { AccountStatus, AuthUser, UserRole } from '@/types/database.types'
import { writeAuditLogs } from './audit-log'
import { cellText } from './excel-cells'
import { EMPLOYMENT_STAGES, SITE_NAMES, TAG_FIELDS, USER_ROLES, type TagField } from './constants'
import { sendWelcomeEmail } from './mailer'
import {
  canManageRole,
  createAccount,
  EMPTY_TAGS,
  type TagIds,
} from './users.service'
import { validateUserInput, type NormalizedUserInput, type UserInput } from './validation'

export const MAX_IMPORT_ROWS = 100
const TEMPLATE_ROWS = 200 // rows that get dropdowns/formatting in the template
const CONCURRENCY = 5

const COLUMNS = [
  'Name',
  'Email',
  'Employee ID',
  'Role',
  'Team',
  'Site',
  'Team Leader Email',
  'Manager Email',
  'QA Auditor Email',
  'Trainer Email',
  'Joining Date',
  'Employment Stage',
  'OJT Start Date',
] as const

type Column = (typeof COLUMNS)[number]

const TAG_COLUMN: Record<TagField, Column> = {
  team_leader_id: 'Team Leader Email',
  manager_id: 'Manager Email',
  quality_auditor_id: 'QA Auditor Email',
  trainer_id: 'Trainer Email',
}

// ── Template ─────────────────────────────────────────────────

export async function generateUserImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()

  const sheet = workbook.addWorksheet('Users')
  sheet.columns = COLUMNS.map((header) => ({ header, key: header, width: header.includes('Email') ? 30 : 20 }))
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF304090' } }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const colLetter = (c: Column) => sheet.getColumn(COLUMNS.indexOf(c) + 1).letter
  const listValidation = (values: string[]): ExcelJS.DataValidation => ({
    type: 'list',
    allowBlank: true,
    formulae: [`"${values.join(',')}"`],
    showErrorMessage: true,
    errorTitle: 'Invalid value',
    error: `Choose one of: ${values.join(', ')}`,
  })

  const dropdowns: [Column, string[]][] = [
    ['Role', USER_ROLES.map((r) => r.label)],
    ['Team', [...TEAM_NAMES]],
    ['Site', [...SITE_NAMES]],
    ['Employment Stage', EMPLOYMENT_STAGES.map((s) => s.label)],
  ]

  for (let r = 2; r <= TEMPLATE_ROWS + 1; r++) {
    for (const [col, values] of dropdowns) {
      sheet.getCell(`${colLetter(col)}${r}`).dataValidation = listValidation(values)
    }
    for (const col of ['Joining Date', 'OJT Start Date'] as Column[]) {
      sheet.getCell(`${colLetter(col)}${r}`).numFmt = 'yyyy-mm-dd'
    }
  }

  const help = workbook.addWorksheet('Instructions')
  help.getColumn(1).width = 28
  help.getColumn(2).width = 90
  const rows: [string, string][] = [
    ['How to use', `Fill in the "Users" sheet (one person per row, max ${MAX_IMPORT_ROWS} rows per upload) and upload it. Do not rename or remove the column headers.`],
    ['What happens', 'Each valid row becomes a user profile. Depending on the option chosen on the upload screen, this either (a) also creates a login and emails a temporary password immediately, or (b) creates a profile only — no login, no email — until an admin later activates that person from the Users screen. Invalid rows are skipped and reported — the rest still import.'],
    ['', ''],
    ['Name', 'Required.'],
    ['Email', 'Required. Must be unique. This is also the login and — for agents — the CRM login used to match their calls.'],
    ['Employee ID', 'Optional. Must be unique if given.'],
    ['Role', `Required. One of: ${USER_ROLES.map((r) => r.label).join(', ')}. Only a Super Admin can create Super Admin / QA Manager accounts.`],
    ['Team', `Required for Agent and Team Lead. Leave blank for Managers (they span teams). One of: ${TEAM_NAMES.join(', ')}.`],
    ['Site', `Required for Agent. One of: ${SITE_NAMES.join(', ')}.`],
    ['Team Leader Email', 'REQUIRED for Agents (every agent reports to a Team Leader; rows without one are rejected). Email of a user with role Team Lead — an existing one, or a Team Lead row in this same file. Optional for everyone else.'],
    ['Manager Email', 'Optional. Email of a Manager or QA Manager. On a TEAM LEAD this is what places them in that Manager\'s reporting chain (BPO Team Leads report to a QA Manager) — a Manager sees their Team Leads and those Team Leads\' agents. On an AGENT it is informational only and grants no access: who can see an agent is decided by their Team Leader. May be someone created earlier in this same file.'],
    ['QA Auditor Email', 'Optional. Email of a user with role QA Auditor.'],
    ['Trainer Email', 'Optional. Email of an existing (or same-file) non-agent user.'],
    ['Joining Date', 'yyyy-mm-dd. Required for active Agents. Must be EMPTY for anyone in OJT / Re-training (it is set when they are certified).'],
    ['Employment Stage', `One of: ${EMPLOYMENT_STAGES.map((s) => s.label).join(', ')}. Blank = Active.`],
    ['OJT Start Date', 'yyyy-mm-dd. Optional.'],
    ['', ''],
    ['Example row', 'Farhan Ahmed | farhan.ahmed@shikho.com | EMP001 | Agent | Telesales | Dhaka | tl@shikho.com | | qa@shikho.com | | 2025-03-01 | Active |'],
  ]
  rows.forEach((r) => help.addRow(r))
  help.getColumn(1).font = { bold: true }
  help.getColumn(2).alignment = { wrapText: true, vertical: 'top' }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export interface BulkRowResult {
  row: number
  name: string
  email: string
  status: 'created' | 'failed'
  reason?: string
  warnings: string[]
}

export interface BulkImportSummary {
  total: number
  created: number
  failed: number
  emailsFailed: number
  accountStatus: AccountStatus
  results: BulkRowResult[]
}

interface ParsedRow {
  row: number
  input: UserInput
  tagEmails: Record<TagField, string>
}

// ── Import ───────────────────────────────────────────────────

export async function bulkCreateUsers(
  actor: AuthUser,
  fileBuffer: Buffer,
  // profile_only by default: the system is still local/in development, so
  // importing the real roster shouldn't hand out live logins and "your
  // account is ready" emails ahead of go-live (§2 addendum, schema_020).
  // Pass 'active' explicitly for the old create-logins-immediately
  // behaviour (e.g. importing a handful of test/admin accounts).
  accountStatus: AccountStatus = 'profile_only'
): Promise<{ ok: true; summary: BulkImportSummary } | { ok: false; error: string }> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer)
  } catch {
    return { ok: false, error: 'Could not read the uploaded file. Please use the provided .xlsx template.' }
  }

  const sheet = workbook.getWorksheet('Users') ?? workbook.worksheets[0]
  if (!sheet) return { ok: false, error: 'The uploaded file has no worksheet.' }

  const colIndex = new Map<string, number>()
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const label = cellText(cell.value)
    if (label) colIndex.set(label, colNumber)
  })
  const missing = COLUMNS.filter((c) => !colIndex.has(c))
  if (missing.length) {
    return { ok: false, error: `Missing columns: ${missing.join(', ')}. Please use the provided template.` }
  }

  const get = (row: ExcelJS.Row, col: Column) => cellText(row.getCell(colIndex.get(col)!).value)

  const parsed: ParsedRow[] = []
  for (let n = 2; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n)
    const input: UserInput = {
      name: get(row, 'Name'),
      email: get(row, 'Email'),
      emp_id: get(row, 'Employee ID'),
      role: get(row, 'Role'),
      team_name: get(row, 'Team'),
      site_name: get(row, 'Site'),
      joining_date: get(row, 'Joining Date'),
      employment_stage: get(row, 'Employment Stage'),
      ojt_start_date: get(row, 'OJT Start Date'),
    }
    const tagEmails = {
      team_leader_id: get(row, TAG_COLUMN.team_leader_id).toLowerCase(),
      manager_id: get(row, TAG_COLUMN.manager_id).toLowerCase(),
      quality_auditor_id: get(row, TAG_COLUMN.quality_auditor_id).toLowerCase(),
      trainer_id: get(row, TAG_COLUMN.trainer_id).toLowerCase(),
    }
    const blank = Object.values(input).every((v) => !v) && Object.values(tagEmails).every((v) => !v)
    if (blank) continue
    parsed.push({ row: n, input, tagEmails })
  }

  if (parsed.length === 0) return { ok: false, error: 'No data rows found in the file.' }
  if (parsed.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `This file has ${parsed.length} rows; the limit is ${MAX_IMPORT_ROWS} per upload. Split it into smaller files.`,
    }
  }

  const admin = getSupabaseAdmin()
  const { data: existing, error: existingError } = await admin
    .from('users')
    .select('id, email, emp_id, role, is_active')
  if (existingError) return { ok: false, error: 'Could not load existing users.' }

  const usersByEmail = new Map((existing ?? []).map((u) => [u.email.toLowerCase(), u]))
  const takenEmpIds = new Set((existing ?? []).map((u) => u.emp_id).filter(Boolean) as string[])

  const results = new Map<number, BulkRowResult>()
  const toCreate: (ParsedRow & { value: NormalizedUserInput })[] = []
  const seenEmails = new Set<string>()
  const seenEmpIds = new Set<string>()

  // Pass 0 — validate everything up front so bad rows are reported
  // without touching the database.
  for (const p of parsed) {
    const base = { row: p.row, name: p.input.name, email: p.input.email.toLowerCase(), warnings: [] as string[] }
    const v = validateUserInput(p.input)
    if (!v.ok) {
      results.set(p.row, { ...base, status: 'failed', reason: v.error })
      continue
    }
    if (!canManageRole(actor.role, v.value.role)) {
      results.set(p.row, { ...base, status: 'failed', reason: `Only a Super Admin can create ${v.value.role} accounts.` })
      continue
    }
    if (usersByEmail.has(v.value.email) || seenEmails.has(v.value.email)) {
      results.set(p.row, { ...base, status: 'failed', reason: 'A user with this email already exists (or appears twice in this file).' })
      continue
    }
    if (v.value.emp_id && (takenEmpIds.has(v.value.emp_id) || seenEmpIds.has(v.value.emp_id))) {
      results.set(p.row, { ...base, status: 'failed', reason: `Employee ID "${v.value.emp_id}" is already used (or appears twice in this file).` })
      continue
    }
    // An agent with no Team Leader is a data-entry error — reject the row
    // rather than import someone who'd be invisible to every Team Lead
    // and Manager (and which the database would refuse anyway).
    if (v.value.role === 'agent' && !p.tagEmails.team_leader_id) {
      results.set(p.row, { ...base, status: 'failed', reason: 'Every agent must have a Team Leader — fill in "Team Leader Email".' })
      continue
    }
    seenEmails.add(v.value.email)
    if (v.value.emp_id) seenEmpIds.add(v.value.emp_id)
    toCreate.push({ ...p, value: v.value })
  }

  // An agent's Team Leader must already exist (active, role Team Lead)
  // or be a Team Lead row elsewhere in this same file.
  const fileTeamLeads = new Set(toCreate.filter((i) => i.value.role === 'team_lead').map((i) => i.value.email))
  for (let i = toCreate.length - 1; i >= 0; i--) {
    const item = toCreate[i]
    if (item.value.role !== 'agent') continue
    const tlEmail = item.tagEmails.team_leader_id
    const existingTl = usersByEmail.get(tlEmail)
    let problem: string | null = null
    if (existingTl) {
      if (existingTl.role !== 'team_lead') problem = `"${tlEmail}" is a ${existingTl.role}, not a Team Lead.`
      else if (!existingTl.is_active) problem = `Team Leader "${tlEmail}" is deactivated.`
    } else if (!fileTeamLeads.has(tlEmail)) {
      problem = `Team Leader "${tlEmail}" was not found — add them first, or include them in this file with role Team Lead.`
    }
    if (problem) {
      results.set(item.row, { row: item.row, name: item.value.name, email: item.value.email, warnings: [], status: 'failed', reason: problem })
      toCreate.splice(i, 1)
    }
  }

  type Item = (typeof toCreate)[number]
  const createdIdByEmail = new Map<string, { id: string; role: UserRole }>()
  let emailsFailed = 0

  // Resolve an item's supervisor emails against existing users plus
  // everyone created so far, so same-file references work.
  const lookup = (email: string): { id: string; role: UserRole; active: boolean } | null => {
    const made = createdIdByEmail.get(email)
    if (made) return { id: made.id, role: made.role, active: true }
    const old = usersByEmail.get(email)
    return old ? { id: old.id, role: old.role as UserRole, active: old.is_active } : null
  }

  function resolveTags(item: Item, selfId: string | null): { tags: TagIds; warnings: string[] } {
    const tags: TagIds = { ...EMPTY_TAGS }
    const warnings: string[] = []
    for (const field of Object.keys(TAG_FIELDS) as TagField[]) {
      const email = item.tagEmails[field]
      if (!email) continue
      const label = TAG_FIELDS[field].label
      const target = lookup(email)
      if (!target) {
        warnings.push(`${label} "${email}" was not found — not linked.`)
      } else if (selfId && target.id === selfId) {
        warnings.push(`Can't be their own ${label} — not linked.`)
      } else if (!target.active) {
        warnings.push(`${label} "${email}" is deactivated — not linked.`)
      } else if (!(TAG_FIELDS[field].roles as UserRole[]).includes(target.role)) {
        warnings.push(`${label} "${email}" has role ${target.role}, which can't be tagged as ${label} — not linked.`)
      } else {
        tags[field] = target.id
      }
    }
    return { tags, warnings }
  }

  // Create accounts in small concurrent batches; each welcome email goes
  // out on one pooled SMTP connection. Agents are created WITH their
  // Team Leader (they can't exist without one), everyone else is created
  // bare and linked afterwards.
  async function createBatch(items: Item[], linkAtCreation: boolean) {
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      await Promise.all(
        items.slice(i, i + CONCURRENCY).map(async (item) => {
          const base = { row: item.row, name: item.value.name, email: item.value.email, warnings: [] as string[] }
          let tags: TagIds = EMPTY_TAGS
          if (linkAtCreation) {
            const resolved = resolveTags(item, null)
            tags = resolved.tags
            if (item.value.role === 'agent' && !tags.team_leader_id) {
              const reason = resolved.warnings.find((w) => w.startsWith('Team Leader')) ?? 'Team Leader could not be linked.'
              results.set(item.row, { ...base, status: 'failed', reason: reason.replace(' — not linked.', '.') })
              return
            }
            base.warnings.push(...resolved.warnings.filter((w) => !w.startsWith('Team Leader')))
          }
          const created = await createAccount(actor, item.value, tags, accountStatus)
          if (!created.ok) {
            results.set(item.row, { ...base, status: 'failed', reason: created.error })
            return
          }
          createdIdByEmail.set(item.value.email, { id: created.id, role: item.value.role })
          // profile_only: no login was created, so there is nothing to
          // email — created.tempPassword is null on this path.
          if (created.tempPassword) {
            try {
              await sendWelcomeEmail(item.value.name, item.value.email, created.tempPassword)
            } catch (err) {
              emailsFailed++
              console.error('Welcome email failed for', item.value.email, err)
              base.warnings.push('Welcome email could not be sent — use Reset password on the Users screen to issue a new one.')
            }
          }
          results.set(item.row, { ...base, status: 'created' })
        })
      )
    }
  }

  // Wave 1 — everyone who isn't an agent (Team Leads, Managers, QA…),
  // so agents' Team Leaders exist before the agents are created.
  const nonAgents = toCreate.filter((i) => i.value.role !== 'agent')
  const agents = toCreate.filter((i) => i.value.role === 'agent')
  await createBatch(nonAgents, false)

  // Link wave-1 supervisors (e.g. a Team Lead's Manager).
  for (const item of nonAgents) {
    const result = results.get(item.row)
    const self = createdIdByEmail.get(item.value.email)
    if (!result || result.status !== 'created' || !self) continue
    const { tags, warnings } = resolveTags(item, self.id)
    result.warnings.push(...warnings)
    if (Object.values(tags).some(Boolean)) {
      const { error } = await admin.from('users').update(tags).eq('id', self.id)
      if (error) result.warnings.push(`Supervisor links could not be saved: ${error.message}`)
    }
  }

  // Wave 2 — agents, each created with their Team Leader.
  await createBatch(agents, true)

  await writeAuditLogs(
    toCreate
      .filter((item) => results.get(item.row)?.status === 'created')
      .map((item) => ({
        actor_id: actor.profile.id,
        action: 'user.created',
        table_name: 'users',
        record_id: createdIdByEmail.get(item.value.email)!.id,
        after_data: { ...item.value, source: 'bulk_import' },
      }))
  )

  const ordered = [...results.values()].sort((a, b) => a.row - b.row)
  return {
    ok: true,
    summary: {
      total: ordered.length,
      created: ordered.filter((r) => r.status === 'created').length,
      failed: ordered.filter((r) => r.status === 'failed').length,
      emailsFailed,
      accountStatus,
      results: ordered,
    },
  }
}
