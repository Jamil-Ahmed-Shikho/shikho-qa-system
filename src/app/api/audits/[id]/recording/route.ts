import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isRecordingFilename, streamRecording } from '@/lib/crm/recording'

// Streaming a recording can outlast the default serverless limit.
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  // Loaded through the signed-in user's own session, so row-level
  // security decides who may hear this recording — exactly the people
  // who can see the audit (a Team Lead only their own team's, a Manager
  // never drafts, an agent none).
  const supabase = await getSupabaseServer()
  const { data: audit } = await supabase.from('audits').select('call_recording_url').eq('id', id).maybeSingle()
  if (!audit) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (!audit.call_recording_url) return NextResponse.json({ error: 'This call has no recording.' }, { status: 404 })
  if (!isRecordingFilename(audit.call_recording_url)) {
    return NextResponse.json({ error: 'This recording has an unrecognised name.' }, { status: 422 })
  }

  return streamRecording(audit.call_recording_url, req.headers.get('range'), req.signal)
}
