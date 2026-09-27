import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth/auth.service'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isRecordingFilename, streamRecording } from '@/lib/crm/recording'

// Streaming a recording can outlast the default serverless limit.
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Same proxy mechanism as an audit's recording (§10), keyed by calibration session. The session is loaded
// through the signed-in user's own session, so RLS (schema_031) decides who may hear it: QA Manager / Super
// Admin, and only the people actually invited — never a Team Lead who wasn't.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const supabase = await getSupabaseServer()
  const { data: s } = await supabase
    .from('calibration_sessions')
    .select('call_recording_url, status')
    .eq('id', id)
    .maybeSingle()
  if (!s) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  if (s.status === 'cancelled') return NextResponse.json({ error: 'This session was cancelled.' }, { status: 404 })
  if (!s.call_recording_url) return NextResponse.json({ error: 'This item has no recording.' }, { status: 404 })
  if (!isRecordingFilename(s.call_recording_url)) {
    return NextResponse.json({ error: 'This recording has an unrecognised name.' }, { status: 422 })
  }
  return streamRecording(s.call_recording_url, req.headers.get('range'), req.signal)
}
