// ============================================================
// SHIKHO QA SYSTEM — Call recording proxy (§10 step 3)
// Server-only.
//
// The CRM's calling-histories `recording_url` is NOT a URL — it is a
// bare filename such as "server3-1789805655.26873-20260…-….mp3". The
// browser can't play that, so /api/audits/[id]/recording streams the
// file from wherever the recordings are hosted (CRM_RECORDING_BASE_URL).
//
// Why a proxy rather than pointing <audio> at the host directly:
//   - the CRM token (if the host needs one) stays server-side — an
//     <audio> tag can't send an Authorization header anyway;
//   - the recording host is never exposed to the browser;
//   - only someone who can already see the audit (RLS) can stream it,
//     so customer call recordings are never publicly reachable;
//   - nothing is downloaded or stored (§10) — bytes stream straight through.
//
// Safety: the only user-influenced input is a filename validated against
// a strict pattern and appended to a base URL from server config — never
// a URL — so this can't be steered at internal hosts (SSRF).
// ============================================================

export const RECORDING_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.(mp3|wav|ogg|m4a|gsm)$/i

const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  gsm: 'audio/x-gsm',
}

const UPSTREAM_HEADER_TIMEOUT_MS = 15_000

export function isRecordingFilename(value: unknown): value is string {
  return typeof value === 'string' && RECORDING_FILE_RE.test(value)
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

/** The configured recordings base URL, or null if unset/unsafe. */
export function recordingBaseUrl(): URL | null {
  const raw = process.env.CRM_RECORDING_BASE_URL?.trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  // A bearer token must never travel in clear text (localhost excepted
  // for development).
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) return null
  return url
}

export function recordingConfigured(): boolean {
  return recordingBaseUrl() !== null
}

function fail(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function upstreamHeaders(withAuth: boolean, range: string | null): HeadersInit {
  const headers: Record<string, string> = { 'X-Log-Ref-Id': `shikho-qa-server-${Date.now()}` }
  if (range) headers.Range = range
  if (withAuth && process.env.CRM_RECORDING_AUTH?.trim().toLowerCase() === 'bearer') {
    headers.Authorization = `Bearer ${process.env.CRM_BEARER_TOKEN}`
  }
  return headers
}

/**
 * Fetches the recording and returns a Response that streams it through.
 * Supports Range requests so the browser can show duration and seek.
 * Failures come back as small JSON bodies ({ error }) so the player can
 * tell the user why, instead of just looking dead.
 */
export async function streamRecording(
  file: string,
  rangeHeader: string | null,
  clientSignal?: AbortSignal
): Promise<Response> {
  if (!isRecordingFilename(file)) return fail(422, 'This recording has an unrecognised name.')

  const base = recordingBaseUrl()
  if (!base) return fail(503, 'Recording playback is not configured yet (CRM_RECORDING_BASE_URL is not set).')

  // Only a single simple byte range is forwarded.
  const range = rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader) ? rangeHeader : null

  const baseHref = base.href.endsWith('/') ? base.href : `${base.href}/`
  let target = new URL(encodeURIComponent(file), baseHref)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_HEADER_TIMEOUT_MS)
  clientSignal?.addEventListener('abort', () => controller.abort(), { once: true })

  try {
    let upstream = await fetch(target, {
      headers: upstreamHeaders(true, range),
      redirect: 'manual',
      signal: controller.signal,
    })

    // A redirect (e.g. to a signed storage URL) is followed once, WITHOUT
    // our credentials — they must only ever go to the configured host.
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const location = upstream.headers.get('location')
      if (!location) return fail(502, 'The recording server sent a redirect with no destination.')
      target = new URL(location, target)
      if (target.protocol !== 'https:' && !(target.protocol === 'http:' && isLocalHost(target.hostname))) {
        return fail(502, 'The recording server redirected to an insecure address.')
      }
      upstream = await fetch(target, {
        headers: upstreamHeaders(false, range),
        redirect: 'error',
        signal: controller.signal,
      })
    }

    clearTimeout(timer)

    if (upstream.status === 404) return fail(404, 'Recording not found on the recording server (it may have been archived).')
    if (upstream.status === 401 || upstream.status === 403) {
      console.error('Recording server rejected our request:', upstream.status, target.host)
      return fail(502, 'The recording server rejected our credentials. Check CRM_RECORDING_AUTH / CRM_BEARER_TOKEN.')
    }
    if (upstream.status === 416) {
      return new Response(null, { status: 416, headers: { 'content-range': upstream.headers.get('content-range') ?? '' } })
    }
    if (upstream.status !== 200 && upstream.status !== 206) {
      console.error('Recording server error:', upstream.status, target.host)
      return fail(502, `The recording server returned an error (${upstream.status}).`)
    }

    // A login page or error page served with 200 must never be streamed
    // to an <audio> tag as if it were audio.
    const upstreamType = (upstream.headers.get('content-type') ?? '').toLowerCase()
    const ext = file.split('.').pop()!.toLowerCase()
    let contentType: string
    if (upstreamType.startsWith('audio/')) contentType = upstreamType
    else if (upstreamType.startsWith('application/octet-stream') || upstreamType.startsWith('binary/')) contentType = MIME_BY_EXT[ext]
    else {
      await upstream.body?.cancel()
      console.error('Recording server returned non-audio content:', upstreamType, target.host)
      return fail(502, 'The recording server returned something that is not audio (it may be redirecting to a login page).')
    }

    const headers = new Headers({
      'content-type': contentType,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
    })
    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h)
      if (v) headers.set(h, v)
    }
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch (err) {
    clearTimeout(timer)
    if (clientSignal?.aborted) return new Response(null, { status: 499 })
    console.error('Recording fetch failed:', err instanceof Error ? err.message : err)
    return fail(504, 'Could not reach the recording server.')
  }
}
