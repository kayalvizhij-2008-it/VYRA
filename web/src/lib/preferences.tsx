import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface Preferences {
  /** Interface transitions, reveals and flip animations. */
  animations: boolean
  /** Animate the persistent WebGL background. */
  backgroundEffects: boolean
  /** Start new automations headless. */
  defaultHeadless: boolean
}

const DEFAULTS: Preferences = {
  animations: true,
  backgroundEffects: true,
  defaultHeadless: true,
}

const STORAGE_KEY = 'vyra.preferences'

function read(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<Preferences>
    return {
      animations: typeof parsed.animations === 'boolean' ? parsed.animations : DEFAULTS.animations,
      backgroundEffects:
        typeof parsed.backgroundEffects === 'boolean' ? parsed.backgroundEffects : DEFAULTS.backgroundEffects,
      defaultHeadless:
        typeof parsed.defaultHeadless === 'boolean' ? parsed.defaultHeadless : DEFAULTS.defaultHeadless,
    }
  } catch {
    return DEFAULTS
  }
}

interface PreferencesState {
  prefs: Preferences
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void
  reset: () => void
}

const PreferencesContext = createContext<PreferencesState | null>(null)

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(read)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      // Storage can be unavailable (private mode/quota); preferences still apply in-memory.
    }
    const root = document.documentElement
    const systemReduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    root.dataset.motion = prefs.animations && !systemReduced ? 'full' : 'reduced'
    root.dataset.effects = prefs.backgroundEffects ? 'on' : 'off'
  }, [prefs])

  const setPref = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((current) => ({ ...current, [key]: value }))
  }, [])

  const reset = useCallback(() => setPrefs(DEFAULTS), [])

  const value = useMemo(() => ({ prefs, setPref, reset }), [prefs, setPref, reset])
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesState {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider')
  return ctx
}
