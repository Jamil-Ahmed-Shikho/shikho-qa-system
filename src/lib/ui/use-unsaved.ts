'use client'

import { useEffect, useId } from 'react'
import { setUnsaved } from './unsaved'

/**
 * Registers a form with the unsaved-changes guard for as long as it is mounted
 * and dirty. Each call site gets its own key, so several forms on one page
 * (an editor's many inline boxes) count independently: leaving is only silent
 * once every one of them is clean. Unmounting clears it, so a form that closes
 * (saved, cancelled, collapsed) never leaves a stale prompt behind.
 */
export function useUnsavedGuard(dirty: boolean): void {
  const key = useId()
  useEffect(() => {
    setUnsaved(key, dirty)
    return () => setUnsaved(key, false)
  }, [key, dirty])
}
