import { BackLink } from '@/components/common/BackLink'
import { HolidayCalendar } from '@/components/admin/holidays/HolidayCalendar'
import { isMissingHolidaysSchema, loadHolidays } from '@/lib/holidays/holidays.service'

export default async function HolidaysAdminPage() {
  let holidays: Awaited<ReturnType<typeof loadHolidays>> | null = null
  let failure: unknown = null
  try {
    holidays = await loadHolidays()
  } catch (err) {
    failure = err
    if (!isMissingHolidaysSchema(err)) console.error(err)
  }

  return (
    <div style={{ maxWidth: '920px' }}>
      <BackLink href="/admin/targets" label="Targets" />
      <h1 style={{ fontSize: '22px', fontWeight: 600, margin: '0 0 4px' }}>Holiday calendar</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: '680px' }}>
        Click a date to mark it as a holiday, with an optional note — for one site or both. The current sales
        week&apos;s audit targets shrink automatically to match the fewer working days (§9.4): the shortfall is
        trimmed from the healthiest agents first (Green, no flags, best revenue) — Red, PIP and zero-seller agents
        keep their full target as long as mathematically possible, and every agent keeps a floor of 1. A holiday
        never changes a week that has already finished.
      </p>

      {failure || !holidays ? (
        isMissingHolidaysSchema(failure) ? (
          <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--highlight)', fontSize: '14px' }}>
            <b>The holiday calendar hasn&apos;t been applied yet.</b> Run <code>supabase/schema_063_holidays.sql</code> in the Supabase SQL Editor, then reload.
          </div>
        ) : (
          <div role="alert" style={{ color: 'var(--alert)', fontSize: '14px' }}>Holidays could not be loaded right now. This does not mean none are set — try again shortly.</div>
        )
      ) : (
        <HolidayCalendar holidays={holidays} />
      )}
    </div>
  )
}
