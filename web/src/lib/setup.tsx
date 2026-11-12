import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type Setup } from './api'

interface SetupState {
  setup: Setup | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const SetupContext = createContext<SetupState | null>(null)

export function SetupProvider({ children }: { children: ReactNode }) {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await api.setup()
      setSetup(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the VYRA server.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 60000)
    return () => window.clearInterval(timer)
  }, [refresh])

  // If the very first probe ran while the API was still starting, keep retrying
  // quickly until the capability snapshot is available.
  useEffect(() => {
    if (setup && !error) return
    const timer = window.setInterval(() => void refresh(), 4000)
    return () => window.clearInterval(timer)
  }, [setup, error, refresh])

  const value = useMemo(() => ({ setup, loading, error, refresh }), [setup, loading, error, refresh])
  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>
}

export function useSetup(): SetupState {
  const ctx = useContext(SetupContext)
  if (!ctx) throw new Error('useSetup must be used inside SetupProvider')
  return ctx
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · VYRA`
    return () => {
      document.title = 'VYRA · Autonomous Browser Intelligence'
    }
  }, [title])
}
