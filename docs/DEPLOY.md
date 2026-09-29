# Deploying the Shikho QA System to Vercel

This is a click-by-click guide — you don't need to know how to code to follow it. It assumes
you're starting from nothing on Vercel's side. Do the sections in order.

**Before you start:** this repository has no GitHub remote yet (checked 2026-09-29 — `git remote -v`
returns nothing). You'll create one in Step 1. Nothing in this guide pushes code or deploys
anything on its own — every step is something you click yourself.

---

## Step 1 — Put the code on GitHub

Vercel deploys by watching a GitHub (or GitLab/Bitbucket) repository — every time you push a
change, it builds and deploys automatically. This is the "clicks, not typing" way to keep
deploying after today.

1. Go to [github.com/new](https://github.com/new) and create a new repository.
   - Name it whatever you like (e.g. `shikho-qa-system`).
   - Set it to **Private** — this codebase has no secrets in it (see the security review
     below), but it's your company's internal tool, so private is the sensible default.
   - Don't check "Add a README" or ".gitignore" — this project already has both.
2. GitHub will show you a page with a remote URL, something like
   `https://github.com/your-username/shikho-qa-system.git`. Copy it.
3. Tell Claude (me) that URL and ask me to add it as the remote and push — I'll run
   `git remote add origin <url>` and `git push -u origin master`, and show you the output
   before and after. I won't do this on my own; you need to ask.

That's the only step that needs me. Everything from here is entirely inside the Vercel
dashboard, at [vercel.com](https://vercel.com).

---

## Step 2 — Create the Vercel project

1. Sign in to [vercel.com](https://vercel.com) (you can sign in with your GitHub account —
   this also grants Vercel permission to see your repositories).
2. Click **Add New...** → **Project** (top right, or on the dashboard's empty state).
3. Under "Import Git Repository", find the repo you created in Step 1 and click **Import**.
4. Vercel will detect this is a Next.js project automatically — leave the Framework Preset
   as **Next.js** and the build/output settings on their defaults. Don't click Deploy yet —
   first add the environment variables below, or the build will fail (it needs the Supabase
   keys to even compile).

---

## Step 3 — Environment variables

Still on the "Configure Project" screen (or afterward via **Settings → Environment
Variables** on the project page), add each of these. Two things matter for each one:

- **Value source** — where the real value comes from.
- **Type** — Vercel lets you mark a variable **Sensitive** (its old name was "Secret" — same
  idea: once saved, Vercel will never show you the value again, only that it's set).
  **Use Sensitive only for the three marked below.** Everything else should be a **plain**
  (non-sensitive) variable, so you can come back later and double-check what you typed
  without having to regenerate it. (Lesson from an earlier build: a Secret-type value can't
  be read back — write it down somewhere safe outside Vercel too, just in case.)

Set every variable for **all three environments** (Production, Preview, Development) unless
noted otherwise — the checkbox is right there when you add each one.

| Variable | Value comes from | Type |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → your project → Settings → API → "Project URL" | Plain |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page → "anon public" key | Plain |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → "service_role" key (click "Reveal") | **Sensitive** |
| `NEXT_PUBLIC_APP_URL` | Your Vercel URL once you know it — e.g. `https://shikho-qa.vercel.app`, or your own domain if you attach one. You can leave this blank for the very first deploy and come back to set it once Vercel gives you the URL, then redeploy. | Plain |
| `GMAIL_SMTP_USER` | The Gmail address sending system emails (currently `jamil.ahmed@shikho.com` in local testing) | Plain |
| `GMAIL_SMTP_APP_PASSWORD` | A Gmail **App Password** (not your normal Gmail password) — generate one at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (needs 2-Step Verification turned on for the account first) | **Sensitive** |
| `EMAIL_FROM` | The "From" address on outgoing emails — usually the same as `GMAIL_SMTP_USER` | Plain |
| `EMAIL_FROM_NAME` | The display name on outgoing emails, e.g. `Shikho QA Audit Management System` | Plain |
| `CRM_BEARER_TOKEN` | Shikho's CRM tech team — this is a short-lived JWT that has expired between sessions before, so expect to refresh it occasionally | **Sensitive** |
| `CRM_API_BASE` | `https://crm-api.shikho.com` | Plain |
| `CRM_RECORDING_BASE_URL` | Where call recordings are hosted — `https://connect.shikho.com/records/` in local testing | Plain |
| `CRM_RECORDING_AUTH` | Either leave blank, or set to `bearer` if the recording host needs the CRM token too | Plain |
| `CRON_SECRET` | A password you make up yourself (any long random string — e.g. generate one at [1password.com/password-generator](https://1password.com/password-generator/) or similar). This is what proves a request to a `/api/cron/*` route really came from Vercel's own cron scheduler, not a stranger. Write it down somewhere safe; if you forget it, generate a new one and update it here — nothing else depends on it staying the same. | **Sensitive** |

### The "off by default" settings — leave these UNSET for now

These control real emails going to real staff. Every one of them defaults to doing nothing
at all if you don't set it, which is the point — several past mistakes elsewhere (accidentally
emailing real people during testing) are exactly what this guards against. **Don't set any of
these until you've read the matching section of `CLAUDE.md` and deliberately decided to go
live with that specific feature.**

| Variable | What happens if unset | Values |
|---|---|---|
| `BRIEFING_DIGEST_MODE` | Nothing — no coaching-schedule digest emails sent | `off` (default) / `preview` / `test` / `live` |
| `BRIEFING_DIGEST_TEST_RECIPIENTS` | Only matters in `test` mode | Comma-separated plus-addressed emails, e.g. `jamil.ahmed+tl1@shikho.com` |
| `CALIBRATION_REPORT_MODE` | Nothing — the "Send report" button says so and sends nothing | `off` (default) / `test` / `live` |
| `CALIBRATION_REPORT_TEST_RECIPIENTS` | Only matters in `test` mode | Comma-separated plus-addressed emails |
| `PIP_NOTIFICATIONS_MODE` | Nothing — the "Send notifications" button says so and sends nothing | `off` (default) / `test` / `live` |
| `PIP_NOTIFICATIONS_TEST_RECIPIENTS` | Only matters in `test` mode | Comma-separated plus-addressed emails |

When you're ready to turn one of these on for real, come back to **Settings → Environment
Variables**, set it to `live`, and redeploy (or just wait for the next automatic deploy) —
it's a deliberate, separate step every time, by design.

---

## Step 4 — Deploy

Click **Deploy**. Vercel will build the project (usually 1–3 minutes) and give you a live
URL when it's done, something like `https://shikho-qa-system.vercel.app`.

Once you have that URL: go back to **Settings → Environment Variables**, set
`NEXT_PUBLIC_APP_URL` to that exact URL (no trailing slash), and click **Redeploy** on the
latest deployment (three-dot menu → Redeploy) so the app actually picks it up — it's used to
build links inside emails.

If you'd rather use your own domain (e.g. `qa.shikho.com`) instead of the `.vercel.app` one,
that's **Settings → Domains** on the project — add the domain, then follow Vercel's
instructions to point your DNS at it (usually one CNAME record). Not required to launch.

---

## Step 5 — Cron jobs (already configured in the code, nothing to click here)

`vercel.json` already declares both scheduled jobs this system needs:

- `revenue-sync` — 22:00 UTC daily (04:00 Bangladesh)
- `briefing-digest` — 17:00 UTC daily (23:00 Bangladesh)

**Vercel's Hobby (free) plan allows at most 2 cron jobs, and each can run at most once per
day** — this project is built exactly to that limit (both existing schema comments call this
out explicitly; don't add a third cron job or a finer schedule without upgrading the plan
first, or Vercel will simply refuse to deploy it).

Both cron routes fail closed: if `CRON_SECRET` isn't set, they return an error instead of
running — so nothing can accidentally happen even if the schedule fires before you've
finished setting up.

---

## Step 6 — Apply the database migrations

Deploying the app code does **not** touch your Supabase database — that's always a separate,
manual step you do yourself in the Supabase SQL Editor, same as it's been throughout this
build. Before your first real deploy, make sure every `supabase/schema_*.sql` file has been
applied, in numeric order, and that any `supabase/fix_*.sql` one-time fixes have been run too.
(As of 2026-09-29: schema_039 through schema_047 are the newest ones — double check nothing
after schema_043 is still missing.)

---

## Step 7 — Post-deploy smoke test

Do these in order, on the real deployed URL (not localhost):

1. **Load the homepage.** It should redirect you to `/auth/login` if you're not signed in.
2. **Sign in** with your own Super Admin account. You should land on the admin dashboard.
3. **Open `/admin/rubrics`** and confirm the three rubrics still show their parameters.
4. **Open `/admin/pip`** and confirm existing PIP cycles/policies still load.
5. **Start a manual audit** on a real (or test) lead ID to confirm the CRM connection works
   (`CRM_BEARER_TOKEN`/`CRM_API_BASE`) — you should see a call list.
6. **Play a recording** on any audited call, to confirm `CRM_RECORDING_BASE_URL` streaming
   works through the proxy.
7. **Check a cron route manually** (safe — it just runs the job once, the same as its
   schedule would): visit
   `https://<your-app>/api/cron/revenue-sync` **with your browser's dev tools open** and add
   the header `Authorization: Bearer <your CRON_SECRET>` (a browser address bar alone can't
   send a custom header — use a tool like [Postman](https://www.postman.com/) or curl, or
   just trust the automatic schedule and check `revenue_sync_state` in Supabase the next
   morning instead). Look for `"status": "ok"` or check `select * from revenue_sync_state;`
   in the SQL Editor afterward.
8. **Sign out and confirm you're bounced back to `/auth/login`** on the next page load.
9. **Try opening `/admin/pip` from a non-admin test account** (or in an incognito window
   without signing in) and confirm you're redirected, not shown the page.
10. **Send yourself a test email** — e.g. schedule a Briefings coaching session (this always
    sends, it's not behind a mode flag) and confirm it actually arrives, to prove
    `GMAIL_SMTP_USER`/`GMAIL_SMTP_APP_PASSWORD` work on Vercel (Gmail SMTP can behave
    differently from a local machine).

If all ten pass, you're live.

---

## Appendix — security review done before this guide was written (2026-09-29)

Checked and clean, so this list is a record, not a to-do:

- **Every route requires sign-in by default** (`src/middleware.ts`) — only `/auth/login`,
  `/auth/reset-password`, `/auth/forgot-password` and `/api/health` are public; everything
  else redirects an unauthenticated visitor to the login page first. Role-specific areas
  (`/admin`, `/audits`, `/pip`, `/calibration`, `/reports`, `/my-audits`, each `/dashboard/*`)
  are additionally restricted to the roles listed in `ROLE_ROUTES`.
- **No leftover test/preview/debug routes** — searched for `zz-*` and similar patterns; the
  only near-match was `bulk/template` (a legitimate Excel-template download), not a leftover.
- **Both cron routes fail closed** — `/api/cron/revenue-sync` and `/api/cron/briefing-digest`
  return an error (not a silent no-op, not a 200) if `CRON_SECRET` isn't configured, and
  compare the given secret with a timing-safe comparison, not a plain `===`.
- **Every other API route checks its own role/session** inside the handler (middleware
  deliberately skips role-checking `/api/*` so it can return real JSON errors instead of an
  HTML redirect) — verified for all six: the two cron routes, the two user-recording proxies
  (RLS-gated through the signed-in user's own session), and the two bulk-user-import routes
  (`super_admin`/`qa_manager` only, checked explicitly).
- **No secret reaches the browser** — the only `NEXT_PUBLIC_*` variables used anywhere are
  the Supabase URL, the Supabase anon key (designed to be public; Row-Level Security is the
  real access boundary) and the app's own URL. `SUPABASE_SERVICE_ROLE_KEY`, `CRM_BEARER_TOKEN`,
  `GMAIL_SMTP_APP_PASSWORD` and `CRON_SECRET` are only ever read inside server-only files
  (confirmed by file location and a clean production build, which would fail if a client
  component tried to import any of them, per this project's own §14 lesson).
- **`.env.local` is gitignored and has never been committed** (checked the full git history,
  not just the current `.gitignore`).
- **The production build (`npm run build`) completes cleanly** with no errors — checked the
  same day this guide was written.
