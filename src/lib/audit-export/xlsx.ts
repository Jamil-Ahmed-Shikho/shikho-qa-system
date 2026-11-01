// ============================================================
// SHIKHO QA SYSTEM — Raw Audit Data Export: workbook builder (2026-11-01)
// Server-only (ExcelJS pulls in Node-only dependencies — never import
// this from a client component). Uses exceljs, not xlsx (CLAUDE.md §14).
// Two sheets: Audits (one row per audit — the effective/current result
// only, Sample Checks and drafts excluded upstream in the SQL) and
// Failed Parameters (one row per FAILED parameter result only — a passed
// parameter carries no feedback, per the scoring rule, so it adds nothing).
// ============================================================

import ExcelJS from 'exceljs'
import { crmLeadUrl } from '@/lib/crm/lead-id-parser'
import type { AuditExportFailedParameterRow, AuditExportSummaryRow } from './audit-export.service'

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF304090' } }
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } }

function dhakaDateTime(iso: string | null): Date | null {
  return iso ? new Date(iso) : null
}

export async function generateAuditExportWorkbook(
  summary: AuditExportSummaryRow[], failedParams: AuditExportFailedParameterRow[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.created = new Date()

  const audits = workbook.addWorksheet('Audits')
  audits.columns = [
    { header: 'Audit ID', key: 'auditId', width: 24 },
    { header: 'Type', key: 'auditType', width: 12 },
    { header: 'Rubric', key: 'rubricName', width: 26 },
    { header: 'Agent', key: 'agentName', width: 24 },
    { header: 'Employee ID', key: 'agentEmpId', width: 14 },
    { header: 'Team', key: 'teamName', width: 14 },
    { header: 'Site', key: 'siteName', width: 10 },
    { header: 'Vintage', key: 'vintageLabel', width: 14 },
    { header: 'Auditor', key: 'auditorName', width: 24 },
    { header: 'Call Date/Time', key: 'callStartedAt', width: 20 },
    { header: 'Call Duration (min)', key: 'callDurationMinutes', width: 16 },
    { header: 'CRM Lead', key: 'crmLead', width: 34 },
    { header: 'Call Status', key: 'callStatus', width: 12 },
    { header: 'Score %', key: 'scorePercent', width: 10 },
    { header: 'Pass/Fail', key: 'passFail', width: 10 },
    { header: 'Critical Fatal', key: 'criticalFail', width: 12 },
    { header: 'Fatal Items', key: 'fatalSummary', width: 40 },
    { header: 'Overall Feedback', key: 'overallFeedback', width: 50 },
    { header: 'Submitted', key: 'submittedAt', width: 20 },
  ]
  audits.getRow(1).font = HEADER_FONT
  audits.getRow(1).fill = HEADER_FILL
  audits.views = [{ state: 'frozen', ySplit: 1 }]
  audits.autoFilter = { from: 'A1', to: 'S1' }

  for (const r of summary) {
    const row = audits.addRow({
      auditId: r.auditId, auditType: r.auditType, rubricName: r.rubricName ?? '—',
      agentName: r.agentName, agentEmpId: r.agentEmpId ?? '', teamName: r.teamName ?? '', siteName: r.siteName ?? '',
      vintageLabel: r.vintageLabel, auditorName: r.auditorName ?? '—',
      callStartedAt: dhakaDateTime(r.callStartedAt), callDurationMinutes: r.callDurationMinutes ?? '',
      crmLead: r.crmLeadId ? crmLeadUrl(r.crmLeadId) : '',
      callStatus: r.callStatus ?? '', scorePercent: r.scorePercent ?? '', passFail: r.passed === null ? '—' : r.passed ? 'Pass' : 'Fail',
      criticalFail: r.criticalFail ? 'Yes' : 'No', fatalSummary: r.fatalSummary ?? '',
      overallFeedback: r.overallFeedback ?? '', submittedAt: dhakaDateTime(r.submittedAt),
    })
    row.getCell('callStartedAt').numFmt = 'yyyy-mm-dd hh:mm'
    row.getCell('submittedAt').numFmt = 'yyyy-mm-dd hh:mm'
    if (r.crmLeadId) row.getCell('crmLead').value = { text: r.crmLeadId, hyperlink: crmLeadUrl(r.crmLeadId) }
    if (!r.passed) row.getCell('passFail').font = { color: { argb: 'FFE03050' }, bold: true }
    if (r.criticalFail) row.getCell('criticalFail').font = { color: { argb: 'FFE03050' }, bold: true }
  }

  const failed = workbook.addWorksheet('Failed Parameters')
  failed.columns = [
    { header: 'Audit ID', key: 'auditId', width: 24 },
    { header: 'Agent', key: 'agentName', width: 24 },
    { header: 'Parameter', key: 'parameterName', width: 30 },
    { header: 'Points Lost', key: 'pointsLost', width: 12 },
    { header: 'Feedback', key: 'feedback', width: 60 },
  ]
  failed.getRow(1).font = HEADER_FONT
  failed.getRow(1).fill = HEADER_FILL
  failed.views = [{ state: 'frozen', ySplit: 1 }]
  failed.autoFilter = { from: 'A1', to: 'E1' }

  for (const r of failedParams) {
    failed.addRow({ auditId: r.auditId, agentName: r.agentName, parameterName: r.parameterName, pointsLost: r.pointsLost, feedback: r.feedback ?? '—' })
  }

  const help = workbook.addWorksheet('About this export')
  help.getColumn(1).width = 100
  const notes = [
    'Shikho QA Audit Management System — raw audit data export.',
    '',
    'Audits: one row per submitted audit in the selected period and your access scope. A Sample Check (no rubric score) is never included. If an audit was later revised through a Review Request, this shows the current/revised result only, not the original.',
    '',
    'Failed Parameters: one row per rubric parameter that FAILED on an audit above. A passed parameter is never listed — it carries no feedback, so there is nothing to show.',
    '',
    'Vintage is the agent\'s CURRENT vintage (as of the day this file was generated), not their vintage at the time of the audit.',
  ]
  notes.forEach((n, i) => { help.getCell(`A${i + 1}`).value = n; help.getCell(`A${i + 1}`).alignment = { wrapText: true } })

  const buf = await workbook.xlsx.writeBuffer()
  return Buffer.from(buf)
}
