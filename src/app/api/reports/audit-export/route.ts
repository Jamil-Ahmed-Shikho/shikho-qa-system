// ============================================================
// SHIKHO QA SYSTEM — Raw Audit Data Export download route (2026-11-01)
// GET only; the two RPCs behind the service layer do their own role/
// scope check (schema_107), so the role check here is a friendly 403,
// same "defense in depth, not the real boundary" shape as every other
// role-gated action in this app.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth/auth.service'
import { isMissingAuditExportSchema, loadAuditExportFailedParameters, loadAuditExportSummary } from '@/lib/audit-export/audit-export.service'
import { generateAuditExportWorkbook } from '@/lib/audit-export/xlsx'
import { ExportRangeError, parseExportPeriod, resolveExportRange } from '@/lib/audit-export/period'
import type { QaRankingView } from '@/lib/qa-ranking/qa-ranking.service'
import { writeAuditLogs } from '@/lib/users/audit-log'

const ALLOWED_ROLES = new Set(['super_admin', 'qa_manager', 'qa_auditor', 'team_lead', 'manager'])

export async function GET(request: NextRequest) {
  const user = await getAuthUser()
  if (!user || !ALLOWED_ROLES.has(user.role)) {
    return NextResponse.json({ error: 'Permission denied.' }, { status: 403 })
  }

  const sp = request.nextUrl.searchParams
  const period = parseExportPeriod(sp.get('period') ?? undefined)
  const view: QaRankingView = sp.get('view') === 'team' ? 'team' : 'mine'

  let range: { from: Date; to: Date }
  try {
    range = resolveExportRange(period, sp.get('from') ?? undefined, sp.get('to') ?? undefined)
  } catch (err) {
    if (err instanceof ExportRangeError) return NextResponse.json({ error: err.message }, { status: 400 })
    throw err
  }

  let summary, failedParams
  try {
    ;[summary, failedParams] = await Promise.all([
      loadAuditExportSummary(range.from, range.to, view, null),
      loadAuditExportFailedParameters(range.from, range.to, view, null),
    ])
  } catch (err) {
    if (isMissingAuditExportSchema(err)) {
      return NextResponse.json({ error: 'This export is not set up yet — run supabase/schema_107_raw_audit_export.sql, then try again.' }, { status: 503 })
    }
    console.error('Audit export failed:', err)
    return NextResponse.json({ error: 'Could not generate the export right now. Try again shortly.' }, { status: 500 })
  }

  const buffer = await generateAuditExportWorkbook(summary, failedParams)

  // Accountability for a data export carrying QA feedback text — who downloaded what scope, when.
  // Never blocks the download itself if the log write fails (writeAuditLogs already swallows its
  // own error, loud in server logs only).
  await writeAuditLogs([{
    actor_id: user.id, action: 'audit_export.downloaded', table_name: 'audits', record_id: null,
    after_data: { period, view, from: range.from.toISOString(), to: range.to.toISOString(), audit_rows: summary.length, failed_parameter_rows: failedParams.length },
  }])

  // Dhaka calendar date, not UTC — range.from/to are half-open instants that often fall on
  // 18:00 UTC (= midnight Dhaka) at a boundary, so reading UTC components directly names the
  // filename a day off from the Dhaka date actually selected.
  const dhakaStamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }) // YYYY-MM-DD
  const stamp = (d: Date) => dhakaStamp.format(d).replaceAll('-', '')
  const filename = `shikho-qa-audit-export-${stamp(range.from)}-${stamp(new Date(range.to.getTime() - 60_000))}.xlsx`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
