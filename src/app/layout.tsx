// ============================================================
// SHIKHO QA SYSTEM — Root Layout
// Global styles · Font · Auth provider
// ============================================================

import type { Metadata, Viewport } from 'next'
import { AuthProvider } from '@/hooks/useAuth'

export const metadata: Metadata = {
  title: { default: 'Shikho QA Audit System', template: '%s — Shikho QA Audit System' },
  description: 'Shikho QA Audit Management System',
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: '#304090',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Tabler Icons — used throughout the app */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/tabler-icons.min.css" />
        {/* Shikho brand fonts — Poppins (English UI), Hind Siliguri (Bangla) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Hind+Siliguri:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body suppressHydrationWarning>
        <style>{globalCSS}</style>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}

// ── Global CSS — Shikho brand design tokens + resets ──────────
// Colors match CLAUDE.md §15. Radii minimum 8px, prefer 12px, everywhere.
const globalCSS = `
  :root {
    /* Shikho Brand Colors */
    --brand:           #304090;  /* Primary Indigo */
    --brand-light:     #F0EEF8;
    --accent:          #C02080;  /* Accent Magenta */
    --accent-light:    #FCE8F4;
    --highlight:       #E0A010;  /* Highlight Sunrise */
    --highlight-light: #FFF8E0;
    --alert:           #E03050;  /* Alert Coral */
    --alert-light:     #FEE8EC;
    --paper:           #FFFFFF;  /* Paper White */
    --ink:             #0F1322;  /* Dark Ink */

    /* Surfaces */
    --surface-0: #F5F4F9;
    --surface-1: #EDEAF5;
    --surface-2: #FFFFFF;

    /* Text */
    --text-primary:   #0F1322;
    --text-secondary: #3D3A5C;
    --text-muted:     #6B6890;

    /* Borders */
    --border:        #DDD9EE;
    --border-strong: #B8B2D8;

    /* RYG status colors */
    --status-red:    #E03050;
    --status-yellow: #E0A010;
    --status-green:  #2E9E5B;

    /* Fonts */
    --font-display: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --font-bangla:  'Hind Siliguri', sans-serif;
    --font: 'Poppins', 'Hind Siliguri', -apple-system, BlinkMacSystemFont, sans-serif;

    /* Radii — sharp corners are banned on interactive surfaces */
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --radius-pill: 999px;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #221F38;
      --surface-0: #14131F;
      --surface-1: #1B1A2C;
      --surface-2: #221F38;
      --text-primary:   #F0EEF8;
      --text-secondary: #B5B0D6;
      --text-muted:     #7C77A0;
      --border:         #35335A;
      --border-strong:  #46437A;
      --brand-light:     #232C52;
      --accent-light:    #3D1B33;
      --highlight-light: #3A2E10;
      --alert-light:     #3D1520;
    }
  }

  *, *::before, *::after { box-sizing: border-box; }
  html { height: 100%; }

  body {
    margin: 0;
    font-family: var(--font);
    background: var(--surface-0);
    color: var(--text-primary);
    min-height: 100svh;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  [lang="bn"], .bangla { font-family: var(--font-bangla); }

  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 10px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }

  :focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
    border-radius: 4px;
  }

  button, input, select, textarea { font-family: inherit; }
`
