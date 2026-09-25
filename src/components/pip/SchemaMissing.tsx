/** True when a failed read looks like "the PIP tables don't exist yet" (schema_027 not applied). */
export function isMissingPipSchema(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /pip_(policies|cycles|candidates|trainings|tl_feedback)/i.test(m) && /(does not exist|schema cache|could not find)/i.test(m)
}

export function SchemaMissing() {
  return (
    <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', background: 'var(--highlight-light)', borderStyle: 'solid', borderWidth: '1px', borderColor: 'var(--highlight)', fontSize: '14px' }}>
      <b>The PIP database changes haven&apos;t been applied yet.</b> Run <code>supabase/schema_027_pip.sql</code> in the Supabase SQL Editor
      (after 025 and 026), then reload this page.
    </div>
  )
}
