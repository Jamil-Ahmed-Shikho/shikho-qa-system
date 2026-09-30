// ============================================================
// SHIKHO QA SYSTEM — Middleware
// Runs on every request — protects routes, refreshes sessions, RBAC
// ============================================================

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = [
  '/auth/login',
  '/auth/reset-password',
  '/auth/forgot-password',
  '/api/health',
]

// Routes only accessible by specific roles
const ROLE_ROUTES: Record<string, string[]> = {
  '/dashboard/admin': ['super_admin', 'qa_manager'],
  '/dashboard/auditor': ['super_admin', 'qa_manager', 'qa_auditor'],
  '/dashboard/manager': ['super_admin', 'qa_manager', 'manager'],
  '/dashboard/team': ['super_admin', 'qa_manager', 'team_lead'],
  '/dashboard/agent': ['super_admin', 'qa_manager', 'team_lead', 'agent'],
  '/admin': ['super_admin', 'qa_manager'],
  '/audits': ['super_admin', 'qa_manager', 'qa_auditor', 'team_lead'],
  // Campaign Report (§4 Part B3) — outside /admin because a Manager, who
  // can't reach /admin/*, still needs their own chain's report. A QA
  // Auditor gets it unrestricted (not scoped to quality_auditor_id); a
  // Team Lead gets it scoped to their own team — both confirmed as
  // corrections after the first build of this step.
  '/reports': ['super_admin', 'qa_manager', 'qa_auditor', 'manager', 'team_lead'],
  // PIPs (§6.4): the approved-or-later PIPs within each role's own scope (the database
  // scopes the rows: Team Lead = own team, Manager = own chain, QA = all). Managing the
  // cycles/candidates is under /admin (Super Admin / QA Manager only).
  // Calibration sessions (§5): QA staff schedule; a Team Lead sees only sessions they were invited to (RLS scopes the rows).
  '/calibration': ['super_admin', 'qa_manager', 'qa_auditor', 'team_lead'],
  '/pip': ['super_admin', 'qa_manager', 'qa_auditor', 'manager', 'team_lead'],
  // An agent's own submitted audits + the place to dispute one (Step 5). Agents only: the page
  // is written for them (it hides QA-internal detail), and RLS limits it to their own audits anyway.
  '/my-audits': ['agent'],
  // Team Leader Checks (schema_057) — a lightweight, Special-Check-only tool, team_lead only.
  // Deliberately NOT super_admin/qa_manager: managing the check DEFINITIONS is under /admin;
  // this route is the logging flow itself, which is a Team Lead's own tool, not an admin one.
  '/tl-checks': ['team_lead'],
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Cron routes authenticate via CRON_SECRET inside the handler — no
  // Supabase session exists when Vercel Cron calls them.
  if (pathname.startsWith('/api/cron/')) {
    return NextResponse.next()
  }

  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  function redirectTo(url: URL) {
    const redirectResponse = NextResponse.redirect(url)
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
    return redirectResponse
  }

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return redirectTo(loginUrl)
  }

  // API routes get their real JSON response, never an HTML redirect —
  // they enforce their own auth/role checks inside the handler. The
  // /auth/* tree is exempt from the forced-password-change redirect so
  // it can't loop against the change-password page itself.
  if (pathname.startsWith('/api/')) return response

  const { data: profile } = await supabase
    .from('users')
    .select('role, must_change_password')
    .eq('auth_id', user.id)
    .single()

  // Accounts created by an admin start with an emailed temporary
  // password — make the user replace it before doing anything else.
  if (profile?.must_change_password && !pathname.startsWith('/auth/')) {
    return redirectTo(new URL('/auth/change-password', request.url))
  }

  const matchedRoute = Object.keys(ROLE_ROUTES).find((route) => pathname.startsWith(route))

  if (matchedRoute) {
    const role = profile?.role as string | undefined

    if (!role || !ROLE_ROUTES[matchedRoute].includes(role)) {
      return redirectTo(new URL('/dashboard', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
