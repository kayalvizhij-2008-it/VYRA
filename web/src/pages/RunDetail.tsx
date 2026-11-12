import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alert, ButtonLink, Icon, Spinner, StatusBadge } from '../components/ui'
import { SkeletonRows } from '../components/Skeleton'
import { api, apiAsset, formatDuration, formatTime, isActive, type Run, type RunEvent } from '../lib/api'
import { useDocumentTitle } from '../lib/setup'

function eventIcon(kind: string, level: string) {
  if (level === 'error') return 'alert' as const
  if (kind === 'step') return 'arrow' as const
  if (kind === 'screenshot') return 'camera' as const
  if (kind === 'guard') return 'shield' as const
  if (kind === 'download') return 'arrow' as const
  if (kind === 'lifecycle') return 'pulse' as const
  return 'clock' as const
}

function elapsedLabel(run: Run | null, event: RunEvent): string {
  const base = run?.started_at || run?.created_at
  if (!base) return ''
  const seconds = Math.max(0, Math.round(event.ts - base))
  if (seconds < 60) return `+${seconds}s`
  return `+${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export default function RunDetail() {
  const { runId } = useParams<{ runId: string }>()
  useDocumentTitle(runId ? `Run ${runId.slice(0, 6)}` : 'Run')
  const navigate = useNavigate()
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    if (!runId) return
    let alive = true
    let timer = 0
    setRun(null)
    setError(null)
    setSelected(0)
    const load = async () => {
      try {
        const next = await api.run(runId)
        if (!alive) return
        setRun(next)
        setError(null)
        timer = window.setTimeout(load, isActive(next.status) ? 1200 : 10000)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Could not load this run.')
        timer = window.setTimeout(load, 5000)
      }
    }
    void load()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [runId])

  useEffect(() => {
    if (!run) return
    const total = run.screenshots?.length ?? 0
    setSelected((current) => (total === 0 ? 0 : Math.min(current, total - 1)))
  }, [run])

  const events = run?.events ?? []
  const screenshots = run?.screenshots ?? []
  const active = run ? isActive(run.status) : false
  const usage = useMemo(() => {
    const entries = Object.entries(run?.usage ?? {}).filter(([, value]) => typeof value === 'number' && value > 0)
    return entries
  }, [run])

  const cancel = async () => {
    if (!run) return
    setBusy(true)
    setActionError(null)
    try {
      setRun(await api.cancelRun(run.id))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not cancel this run.')
    } finally {
      setBusy(false)
    }
  }

  if (error && !run) {
    return (
      <div className="page">
        <Alert tone="error" title="Run unavailable">
          {error}
        </Alert>
        <div className="mt-16">
          <Link to="/runs" className="link-quiet">
            <Icon name="arrow" size={14} /> Back to history
          </Link>
        </div>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="page">
        <div className="card">
          <SkeletonRows rows={4} />
        </div>
      </div>
    )
  }

  const currentShot = screenshots[selected]

  return (
    <div className="page">
      <header className="run-head">
        <div className="run-head__top">
          <Link to="/runs" className="back-link">
            <Icon name="chevron" size={14} className="flip" /> History
          </Link>
          <span className="mono muted">run_{run.id.slice(0, 8)}</span>
        </div>
        <div className="run-head__main">
          <div>
            <div className="run-head__badges">
              <StatusBadge status={run.status} />
              <span className="pill">{run.provider}</span>
              <span className="pill">{run.model}</span>
              <span className="pill">{run.browser_mode === 'local' ? (run.headless ? 'local · headless' : 'local · visible') : run.browser_mode}</span>
            </div>
            <h1 className="run-head__task">{run.task}</h1>
            <p className="run-head__when">
              Created {formatTime(run.created_at)}
              {run.started_at ? ` · started ${formatTime(run.started_at)}` : ''}
              {run.finished_at ? ` · ended ${formatTime(run.finished_at)}` : ''}
            </p>
          </div>
          <div className="run-head__actions">
            {active && (
              <button type="button" className="btn btn--danger" onClick={() => void cancel()} disabled={busy}>
                <Icon name="stop" size={16} />
                {busy ? 'Stopping…' : 'Cancel run'}
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={async () => {
                setBusy(true)
                setActionError(null)
                try {
                  const next = await api.retryRun(run.id)
                  navigate(`/runs/${next.id}`)
                } catch (err) {
                  setActionError(err instanceof Error ? err.message : 'Could not re-run this brief.')
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy}
            >
              <Icon name="retry" size={16} /> Re-run
            </button>
            <ButtonLink to="/new" variant="quiet" icon="plus">
              New
            </ButtonLink>
          </div>
        </div>
        {active && (
          <div className="live-strip">
            <span className="live-dot is-ok" aria-hidden="true" />
            <span>
              {run.status === 'queued'
                ? 'Queued — the engine will pick this up as soon as a slot is free.'
                : 'Agent active. Steps and screenshots update live from the engine.'}
            </span>
          </div>
        )}
        {actionError && (
          <Alert tone="error" title="Action failed">
            {actionError}
          </Alert>
        )}
      </header>

      <div className="run-layout">
        <section className="card run-timeline">
          <div className="section-head">
            <div>
              <h2>Execution timeline</h2>
              <p>{events.length} event{events.length === 1 ? '' : 's'} captured</p>
            </div>
            <span className="pill pill--muted">
              {run.steps ?? 0} / {run.max_steps} steps
            </span>
          </div>
          {events.length === 0 ? (
            <div className="loading-row">
              <Spinner label="Waiting for events" /> Waiting for the first engine event…
            </div>
          ) : (
            <ol className="timeline">
              {events.map((event) => (
                <li key={event.id} className={`timeline__item level-${event.level}`}>
                  <span className="timeline__icon" aria-hidden="true">
                    <Icon name={eventIcon(event.kind, event.level)} size={14} />
                  </span>
                  <div className="timeline__body">
                    <div className="timeline__meta">
                      <span className="timeline__kind">{event.kind}</span>
                      <span>{elapsedLabel(run, event)}</span>
                      <span>{new Date(event.ts * 1000).toLocaleTimeString()}</span>
                    </div>
                    <p className={event.kind === 'step' ? 'timeline__step' : ''}>{event.message}</p>
                  </div>
                </li>
              ))}
              {active && (
                <li className="timeline__item timeline__item--pending">
                  <span className="timeline__icon" aria-hidden="true">
                    <span className="spinner spinner--sm" />
                  </span>
                  <div className="timeline__body">
                    <p>Listening to the engine…</p>
                  </div>
                </li>
              )}
            </ol>
          )}
        </section>

        <aside className="run-rail">
          <section className="card">
            <div className="section-head">
              <div>
                <h2>Browser evidence</h2>
                <p>Real engine screenshots only</p>
              </div>
              <Icon name="camera" size={18} />
            </div>
            {currentShot ? (
              <>
                <a
                  className="shot-main"
                  href={apiAsset(`/api/runs/${run.id}/screenshots/${encodeURIComponent(currentShot.filename)}`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={apiAsset(`/api/runs/${run.id}/screenshots/${encodeURIComponent(currentShot.filename)}`)}
                    alt={`${currentShot.label} captured by the agent`}
                    loading="lazy"
                  />
                  <span className="shot-main__label">{currentShot.label}</span>
                </a>
                {screenshots.length > 1 && (
                  <div className="shot-thumbs" role="tablist" aria-label="Screenshots">
                    {screenshots.map((shot, index) => (
                      <button
                        key={shot.id}
                        type="button"
                        role="tab"
                        aria-selected={index === selected}
                        className={`shot-thumb ${index === selected ? 'is-active' : ''}`}
                        onClick={() => setSelected(index)}
                      >
                        <img
                          src={apiAsset(`/api/runs/${run.id}/screenshots/${encodeURIComponent(shot.filename)}`)}
                          alt={shot.label}
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="shot-empty">
                <Icon name="camera" size={22} />
                <p>No screenshots yet.</p>
                <small>
                  The agent captures a screenshot only when it decides one is useful. Images appear here the moment the engine
                  writes them — VYRA never renders a fake browser view.
                </small>
              </div>
            )}
          </section>

          <section className="card">
            <div className="section-head">
              <div>
                <h2>Outcome</h2>
                <p>{run.status === 'completed' ? 'Final answer from the agent' : 'Result and diagnostics'}</p>
              </div>
            </div>
            {run.error && (
              <Alert tone={run.status === 'cancelled' ? 'warning' : 'error'} title={run.status === 'cancelled' ? 'Cancelled' : 'Error'}>
                {run.error}
              </Alert>
            )}
            {run.result_text ? (
              <pre className="result-text">{run.result_text}</pre>
            ) : (
              !run.error && (
                <p className="muted small">
                  {active ? 'The agent is still working. The final result is stored when the loop ends.' : 'The engine returned no final text for this run.'}
                </p>
              )
            )}
            <dl className="kv-list kv-list--tight">
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(run.duration_s)}</dd>
              </div>
              <div>
                <dt>Model steps</dt>
                <dd>{run.steps ?? '—'}</dd>
              </div>
              <div>
                <dt>Reported cost</dt>
                <dd>{run.cost_usd != null ? `$${run.cost_usd.toFixed(4)}` : '—'}</dd>
              </div>
              {usage.map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replace(/_/g, ' ')}</dt>
                  <dd>{value.toLocaleString()}</dd>
                </div>
              ))}
              <div>
                <dt>Success</dt>
                <dd>{run.success == null ? 'Not judged' : run.success ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
          </section>

          <section className="card card--quiet">
            <div className="section-head">
              <div>
                <h2>Configuration</h2>
                <p>Immutable record for this run</p>
              </div>
            </div>
            <dl className="kv-list kv-list--tight">
              <div>
                <dt>Provider</dt>
                <dd>{run.provider}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd className="mono">{run.model}</dd>
              </div>
              <div>
                <dt>Browser</dt>
                <dd>
                  {run.browser_mode}
                  {run.browser_mode === 'local' ? (run.headless ? ' · headless' : ' · visible') : ''}
                </dd>
              </div>
              <div>
                <dt>Timeout</dt>
                <dd>{run.timeout_s}s</dd>
              </div>
              <div>
                <dt>Allowed</dt>
                <dd>{run.allowed_domains.length ? run.allowed_domains.join(', ') : 'unrestricted'}</dd>
              </div>
              <div>
                <dt>Blocked</dt>
                <dd>{run.prohibited_domains.length ? run.prohibited_domains.join(', ') : 'none'}</dd>
              </div>
              {run.risk_flags.length > 0 && (
                <div>
                  <dt>Acknowledged</dt>
                  <dd>{run.risk_flags.join(', ')}</dd>
                </div>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  )
}
