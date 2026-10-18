// ============================================================
// SHIKHO QA SYSTEM — manual non-call audit reference (chat/complaint,
// audits.item_reference, 2026-10-19). Shared by /audits/[id], /my-audits/[id]
// and the audit-result email so URL-detection and wording never drift
// between the three places a ticket/chat reference is shown.
// ============================================================

export function isLikelyUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim())
}

export function itemReferenceLabel(auditType: string): string {
  return auditType === 'complaint' ? 'Complaint reference' : 'Chat reference'
}
