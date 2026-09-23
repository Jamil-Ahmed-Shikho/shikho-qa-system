// ============================================================
// SHIKHO QA SYSTEM — Logo
// Real Shikho logo lockup (public/shikho-logo.png) — bird mark
// + "shikho" wordmark baked into one image. Per brand guide:
// "Use the original PNG/SVG — never recreate the bird." Render
// at natural aspect ratio — don't force it into a square icon box.
// ============================================================

export function ShikhoBirdMark({ height = 32, knockout = false }: { height?: number; knockout?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/shikho-logo.png"
      alt="Shikho"
      style={{
        height, width: 'auto', display: 'inline-block',
        filter: knockout ? 'brightness(0) invert(1)' : 'none',
      }}
    />
  )
}
