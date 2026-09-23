// ============================================================
// SHIKHO QA SYSTEM — Excel cell reading
// Pure helper for the bulk import. Excel cells aren't always plain
// strings: typed emails often become hyperlink objects, rich text is an
// array of runs, formulas carry a result, and dates arrive as Date
// objects (UTC midnight, no timezone).
// ============================================================

import type ExcelJS from 'exceljs'

export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text).join('').trim()
    }
    if ('result' in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue)
    return ''
  }
  return String(value).trim()
}
