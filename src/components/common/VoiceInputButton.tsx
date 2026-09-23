'use client'
// ============================================================
// SHIKHO QA SYSTEM — Voice-to-text button (Web Speech API — Chrome)
// Ported from the Shikho CMS (components/complaints/VoiceInputButton.tsx):
// same look, same behaviour — defaults to Bangla, EN/বাং toggle remembered
// per browser, only finished phrases are handed back.
// Place inside a `position: relative` wrapper — it positions itself
// absolute, bottom-right — and leave ~92px of right padding on the field.
//
// Differences from the CMS copy, both because the scorecard shows and hides
// fields as you work:
//   - it stops listening when it unmounts (e.g. the parameter it belonged
//     to is switched back to Pass) instead of leaving the mic open;
//   - it always calls the LATEST onTranscript, not the one from when
//     recording started.
// ============================================================

import { useState, useEffect, useRef } from 'react'

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void
  className?: string
}

type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript: string } }
type SpeechRecognitionEventLike = { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
type SpeechRecognitionErrorEventLike = { error: string }
type SpeechRecognitionLike = {
  continuous: boolean; interimResults: boolean; lang: string
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void; stop: () => void; abort: () => void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export function VoiceInputButton({ onTranscript, className }: VoiceInputButtonProps) {
  const [recording, setRecording] = useState(false)
  const [supported, setSupported] = useState(true)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [lang, setLang] = useState<'en' | 'bn'>('bn')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  useEffect(() => {
    if (!getCtor()) setSupported(false)
    try {
      const saved = window.localStorage.getItem('voice-lang')
      if (saved === 'en' || saved === 'bn') setLang(saved)
    } catch { /* storage blocked — Bangla stays the default */ }
  }, [])

  // Never leave the microphone open behind a field that has gone away.
  useEffect(() => {
    return () => {
      const r = recognitionRef.current
      if (r) {
        r.onresult = null; r.onerror = null; r.onend = null
        try { r.abort() } catch { /* already stopped */ }
        recognitionRef.current = null
      }
    }
  }, [])

  function selectLang(next: 'en' | 'bn') {
    setLang(next)
    try { window.localStorage.setItem('voice-lang', next) } catch { /* storage blocked */ }
  }

  function toggleRecording() {
    const Ctor = getCtor()
    if (!Ctor) { setSupported(false); return }

    if (recording) {
      recognitionRef.current?.stop()
      return
    }

    setVoiceError(null)

    const recognition = new Ctor()
    // interimResults:true is required for reliability — with it false,
    // Chrome often withholds any "final" result until a long silence,
    // so stopping before that point yields nothing at all.
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = lang === 'bn' ? 'bn-BD' : 'en-US'

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          const text = result[0].transcript.trim()
          if (text) onTranscriptRef.current(text)
        }
      }
    }
    recognition.onerror = (event) => {
      setRecording(false)
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setVoiceError('Microphone access denied. Check your browser permissions.')
      } else if (event.error === 'no-speech') {
        setVoiceError('No speech detected. Try again.')
      } else if (event.error !== 'aborted') {
        setVoiceError('Voice input failed. Please try again.')
      }
    }
    recognition.onend = () => setRecording(false)

    recognitionRef.current = recognition
    try {
      recognition.start()
      setRecording(true)
    } catch {
      setVoiceError('Could not start voice input.')
    }
  }

  if (!supported) return null

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={toggleRecording}
        aria-label={recording ? 'Stop voice input' : 'Start voice input'}
        title={recording ? 'Stop recording' : 'Voice input (Chrome only)'}
        style={{
          position: 'absolute', right: 8, bottom: 8,
          padding: '8px 10px', borderRadius: 8,
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: recording ? '#C02080' : '#304090',
          color: 'white',
          animation: recording ? 'pulse-mic 1.2s ease-in-out infinite' : 'none',
          transition: 'background .15s',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
          <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
        </svg>
        <style>{`@keyframes pulse-mic { 0%,100% { box-shadow: 0 0 0 0 rgba(192,32,128,0.5);} 50% { box-shadow: 0 0 0 6px rgba(192,32,128,0);} }`}</style>
      </button>
      {!recording && (
        <div style={{
          position: 'absolute', right: 46, bottom: 8, height: 34, display: 'flex', alignItems: 'center',
          gap: 2, background: 'var(--surface-1)', borderRadius: 8, padding: 2,
        }}>
          <button
            type="button"
            onClick={() => selectLang('en')}
            aria-label="English voice input"
            aria-pressed={lang === 'en'}
            style={{
              padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 600, fontFamily: 'inherit',
              background: lang === 'en' ? '#304090' : 'transparent',
              color: lang === 'en' ? 'white' : '#6B6890',
            }}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => selectLang('bn')}
            aria-label="Bangla voice input"
            aria-pressed={lang === 'bn'}
            style={{
              padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 600, fontFamily: 'inherit',
              background: lang === 'bn' ? '#304090' : 'transparent',
              color: lang === 'bn' ? 'white' : '#6B6890',
            }}
          >
            বাং
          </button>
        </div>
      )}
      {recording && (
        <span style={{ position: 'absolute', right: 46, bottom: 14, fontSize: 11, color: '#C02080' }}>
          Listening...
        </span>
      )}
      {voiceError && (
        <span style={{ position: 'absolute', right: 8, bottom: 46, fontSize: 11, color: 'var(--alert)', whiteSpace: 'nowrap' }}>
          {voiceError}
        </span>
      )}
    </>
  )
}
