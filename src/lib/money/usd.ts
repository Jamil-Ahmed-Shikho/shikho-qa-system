// US-dollar display. Revenue is stored in BDT and converted per sale in the database
// (agent_revenue_usd, schema_029); this only FORMATS an amount that is already in dollars.

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 1234.5 -> "$1,234.50". Not a number (or not finite) -> "—", never "$NaN". */
export function formatUsd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—'
  return usd.format(amount)
}
