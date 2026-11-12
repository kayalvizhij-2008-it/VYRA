export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout' | 'max_steps'

export interface Run {
  id: string
  task: string
  status: RunStatus
  created_at: number
  started_at: number | null
  finished_at: number | null
  provider: string
  model: string
  browser_mode: string
  headless: boolean
  allowed_domains: string[]
  prohibited_domains: string[]
  max_steps: number
  timeout_s: number
  result_text: string | null
  error: string | null
  steps: number | null
  cost_usd: number | null
  usage: Record<string, number>
  success: boolean | null
  cancelled: boolean
  duration_s: number | null
  risk_flags: string[]
  events?: RunEvent[]
  screenshots?: Screenshot[]
}

export interface RunEvent {
  id: number
  run_id: string
  ts: number
  kind: string
  level: 'info' | 'warning' | 'error'
  message: string
  data: Record<string, unknown>
}

export interface Screenshot {
  id: number
  run_id: string
  ts: number
  label: string
  filename: string
}

export interface ProviderStatus {
  id: string
  label: string
  configured: boolean
  env_keys: string[]
  require_all_env: boolean
  missing_env: string[]
  models: string[]
  default_model: string
  note: string
}

export interface BrowserEngine {
  id: string
  label: string
  available: boolean
  executable: string
}

export interface Setup {
  engine: {
    package: string
    version: string | null
    installed: boolean
    upstream: string | null
    commit: string | null
    license: boolean
  }
  python: string
  providers: ProviderStatus[]
  browsers: BrowserEngine[]
  cloud_browser: { available: boolean; env: string; billed: boolean }
  env_present: Record<string, boolean>
  data_dir: string
  limits: {
    max_active_runs: number
    default_max_steps: number
    default_timeout_s: number
    default_headless: boolean
  }
}

export interface RunStats {
  total: number
  active: number
  last_24h: number
  total_cost_usd: number
  by_status: Record<string, number>
}

export interface Template {
  id: string
  title: string
  prompt: string
  category: string
  built_in: number
}

export interface EngineTool {
  id: string
  name: string
  detail: string
  source: string
}

export interface Integrations {
  providers: ProviderStatus[]
  browsers: BrowserEngine[]
  cloud: { available: boolean; env: string; billed: boolean }
  tools: EngineTool[]
  engine: Setup['engine']
  cost_note: string
}

export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, detail: unknown, message: string) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

// Production builds point this at the API service (Render). Development stays
// same-origin so the Vite proxy keeps working.
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export function apiAsset(path: string): string {
  return `${API_BASE}${path}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!response.ok) {
    let detail: unknown = null
    try {
      detail = (await response.json()).detail
    } catch {
      detail = response.statusText
    }
    const text =
      typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object' && 'message' in detail
          ? String((detail as { message: unknown }).message)
          : `Request failed (${response.status})`
    throw new ApiError(response.status, detail, text)
  }
  return (await response.json()) as T
}

export const api = {
  setup: () => request<Setup>('/api/setup'),
  integrations: () => request<Integrations>('/api/integrations'),
  settings: () => request<{ setup: Setup; safety: Record<string, string> }>('/api/settings'),
  runs: (status?: string, q?: string, limit = 50) => {
    const params = new URLSearchParams()
    if (status && status !== 'all') params.set('status', status)
    if (q) params.set('q', q)
    params.set('limit', String(limit))
    const suffix = params.toString()
    return request<{ runs: Run[]; stats: RunStats }>(`/api/runs${suffix ? `?${suffix}` : ''}`)
  },
  run: (id: string) => request<Run>(`/api/runs/${id}`),
  createRun: (payload: Record<string, unknown>) =>
    request<Run>('/api/runs', { method: 'POST', body: JSON.stringify(payload) }),
  cancelRun: (id: string) => request<Run>(`/api/runs/${id}/cancel`, { method: 'POST' }),
  retryRun: (id: string) => request<Run>(`/api/runs/${id}/retry`, { method: 'POST' }),
  templates: () => request<Template[]>('/api/templates'),
  createTemplate: (payload: { title: string; prompt: string; category: string }) =>
    request<Template>('/api/templates', { method: 'POST', body: JSON.stringify(payload) }),
  deleteTemplate: (id: string) => request<{ deleted: boolean }>(`/api/templates/${id}`, { method: 'DELETE' }),
  profiles: () =>
    request<{
      engines: BrowserEngine[]
      modes: { id: string; label: string; description: string; persistent: boolean }[]
      note: string
    }>('/api/profiles'),
  health: () => request<{ ok: boolean; engine_installed: boolean; active_runs: number }>('/api/health'),
}

export const TERMINAL_STATUSES: RunStatus[] = ['completed', 'failed', 'cancelled', 'timeout', 'max_steps']

export function isActive(status: RunStatus): boolean {
  return status === 'queued' || status === 'running'
}

export function formatRelative(ts: number | null | undefined): string {
  if (!ts) return '—'
  const seconds = Math.max(0, Date.now() / 1000 - ts)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString()
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timeout: 'Timed out',
  max_steps: 'Step limit',
}
