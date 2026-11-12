import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ButtonLink, EmptyState, Icon, SectionHeader, StatusBadge } from '../components/ui'
import FlipCard from '../components/FlipCard'
import Reveal from '../components/Reveal'
import { SkeletonRows } from '../components/Skeleton'
import { api, formatRelative, type Run, type RunStats, type Template } from '../lib/api'
import { useDocumentTitle, useSetup } from '../lib/setup'

export default function Overview() {
  useDocumentTitle('Overview')
  const { setup } = useSetup()
  const [runs, setRuns] = useState<Run[]>([])
  const [stats, setStats] = useState<RunStats | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let timer = 0
    const load = async () => {
      try {
        const data = await api.runs()
        if (cancelled) return
        setRuns(data.runs)
        setStats(data.stats)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load runs.')
      } finally {
        if (!cancelled) setLoading(false)
      }
      if (!cancelled) timer = window.setTimeout(load, 4000)
    }
    void load()
    void api
      .templates()
      .then((items) => !cancelled && setTemplates(items.slice(0, 4)))
      .catch(() => undefined)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  const configured = setup?.providers.filter((p) => p.configured) ?? []
  const browsers = setup?.browsers ?? []
  const checks = [
    {
      label: 'browser-use engine installed',
      ok: Boolean(setup?.engine.installed),
      detail: setup?.engine.version ? `v${setup.engine.version}${setup.engine.commit ? ` · ${setup.engine.commit}` : ''}` : 'Not importable',
      to: '/settings',
    },
    {
      label: 'Model provider configured',
      ok: configured.length > 0,
      detail: configured.length ? configured.map((p) => p.label).join(', ') : 'Add a provider key in server/.env',
      to: '/settings',
    },
    {
      label: 'Local browser detected',
      ok: browsers.length > 0,
      detail: browsers.length ? browsers.map((b) => b.label).join(', ') : 'Install Chrome, Chromium or Edge',
      to: '/profiles',
    },
    {
      label: 'Cloud browser (optional)',
      ok: Boolean(setup?.cloud_browser.available),
      detail: setup?.cloud_browser.available ? 'Key present · billed per browser-hour' : 'Optional · needs BROWSER_USE_API_KEY',
      to: '/integrations',
      optional: true,
    },
  ]

  return (
    <div className="page">
      <section className="hero">
        <div className="hero__content">
          <p className="kicker">Autonomous browser intelligence</p>
          <h1>
            Give intent.
            <br />
            <em>Watch it act.</em>
          </h1>
          <p className="hero__lede">
            VYRA operates a real browser through the open-source browser-use engine: one persistent Python REPL,
            raw Chrome DevTools Protocol, and every step observable as it happens.
          </p>
          <div className="hero__actions">
            <ButtonLink to="/new" icon="arrow">
              Start an automation
            </ButtonLink>
            <ButtonLink to="/runs" variant="ghost">
              Review history
            </ButtonLink>
          </div>
          <div className="hero__meta">
            <span>
              Engine <strong>{setup?.engine.version ?? '—'}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {configured.length} provider{configured.length === 1 ? '' : 's'} ready
            </span>
            <span aria-hidden="true">·</span>
            <span>{browsers.length} local browser{browsers.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="hero__panel">
          <div className="hero__panel-head">
            <span>Control plane</span>
            <span className={`live-dot ${configured.length ? 'is-ok' : 'is-warn'}`} aria-hidden="true" />
          </div>
          <div className="hero__numbers">
            <div>
              <strong>{stats?.active ?? 0}</strong>
              <span>in flight</span>
            </div>
            <div>
              <strong>{stats?.last_24h ?? 0}</strong>
              <span>last 24h</span>
            </div>
            <div>
              <strong>{stats?.total ?? 0}</strong>
              <span>total runs</span>
            </div>
          </div>
          <p className="hero__panel-note">Every value here is read from the engine and the run store. Nothing is simulated.</p>
        </div>
      </section>

      <section className="stat-row stat-row--flip" aria-label="Run statistics — flip a card for detail">
        <FlipCard
          title="Active now"
          value={stats?.active ?? 0}
          caption={`${stats?.by_status.running ?? 0} running · ${stats?.by_status.queued ?? 0} queued`}
          icon="pulse"
          tone="violet"
          backTitle="In-flight work"
          backBody={`${stats?.by_status.queued ?? 0} queued and ${stats?.by_status.running ?? 0} executing right now. Live steps stream into each run workspace as the engine reports them.`}
          action={{ to: '/runs', label: 'Open run history' }}
        />
        <FlipCard
          title="Completed"
          value={stats?.by_status.completed ?? 0}
          caption={`of ${stats?.total ?? 0} recorded runs`}
          icon="check"
          tone="lime"
          delay={60}
          backTitle="Finished missions"
          backBody={`${stats?.total ? Math.round(((stats?.by_status.completed ?? 0) / stats.total) * 100) : 0}% of recorded runs reached a final result. Success is judged by the engine and stored with the run.`}
          action={{ to: '/runs', label: 'Review results' }}
        />
        <FlipCard
          title="Needs attention"
          value={(stats?.by_status.failed ?? 0) + (stats?.by_status.timeout ?? 0) + (stats?.by_status.max_steps ?? 0)}
          caption={`${stats?.by_status.cancelled ?? 0} cancelled by you`}
          icon="alert"
          tone="amber"
          delay={120}
          backTitle="Ended without a result"
          backBody={`${stats?.by_status.failed ?? 0} failed · ${stats?.by_status.timeout ?? 0} timed out · ${stats?.by_status.max_steps ?? 0} hit the step limit. Open a run to see the engine's error and timeline.`}
          action={{ to: '/runs', label: 'Inspect runs' }}
        />
        <FlipCard
          title="Reported spend"
          value={stats?.total_cost_usd ? `$${stats.total_cost_usd.toFixed(2)}` : '—'}
          caption="engine-reported model cost only"
          icon="clock"
          tone="rose"
          delay={180}
          backTitle="How cost is measured"
          backBody="Each run stores the engine's genai-prices estimate for model usage. Browser Use Cloud time, if enabled, is billed separately by that provider."
          action={{ to: '/integrations', label: 'Billing details' }}
        />
      </section>

      <Reveal className="split split--main" delay={40}>
        <section className="card">
          <SectionHeader
            title="Recent runs"
            hint="Live state from the run store"
            action={
              <Link to="/runs" className="link-quiet">
                View all <Icon name="arrow" size={14} />
              </Link>
            }
          />
          {error && <div className="inline-error">{error}</div>}
          {loading ? (
            <SkeletonRows rows={3} />
          ) : runs.length === 0 ? (
            <EmptyState
              title="No missions yet"
              body="Describe a browser task and VYRA will hand it to the real browser-use agent. The first run appears here while it executes."
              action={<ButtonLink to="/new">Compose the first automation</ButtonLink>}
            />
          ) : (
            <ul className="run-list">
              {runs.slice(0, 6).map((run) => (
                <li key={run.id}>
                  <Link to={`/runs/${run.id}`} className="run-row">
                    <span className="run-row__status">
                      <StatusBadge status={run.status} small />
                    </span>
                    <span className="run-row__task">
                      {run.task}
                      <small>
                        {run.provider} · {run.model} · {run.browser_mode}
                      </small>
                    </span>
                    <span className="run-row__meta">
                      <span>{formatRelative(run.created_at)}</span>
                      <Icon name="chevron" size={15} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="card card--quiet">
          <SectionHeader title="Setup status" hint="What the server can actually do" />
          <ul className="check-list">
            {checks.map((check) => (
              <li key={check.label} className={check.ok ? 'is-ok' : check.optional ? 'is-muted' : 'is-warn'}>
                <span className="check-list__icon" aria-hidden="true">
                  <Icon name={check.ok ? 'check' : 'alert'} size={15} />
                </span>
                <span className="check-list__text">
                  <strong>{check.label}</strong>
                  <small>{check.detail}</small>
                </span>
                <Link to={check.to} aria-label={`Open ${check.label} settings`}>
                  <Icon name="chevron" size={14} />
                </Link>
              </li>
            ))}
          </ul>
          <p className="fineprint">
            Credentials live only in the server environment. The browser never receives provider keys, cookies or profile data.
          </p>
        </aside>
      </Reveal>

      <Reveal as="section" className="section-block" delay={80}>
        <SectionHeader
          title="Quick starts"
          hint="Populate the composer — nothing runs until you submit"
          action={
            <Link to="/new" className="link-quiet">
              Open composer <Icon name="arrow" size={14} />
            </Link>
          }
        />
        <div className="template-grid">
          {templates.map((template) => (
            <Link key={template.id} to="/new" state={{ prompt: template.prompt, title: template.title }} className="template-card">
              <span className="template-card__category">{template.category}</span>
              <strong>{template.title}</strong>
              <p>{template.prompt}</p>
              <span className="template-card__cta">
                Use prompt <Icon name="arrow" size={14} />
              </span>
            </Link>
          ))}
        </div>
      </Reveal>
    </div>
  )
}
