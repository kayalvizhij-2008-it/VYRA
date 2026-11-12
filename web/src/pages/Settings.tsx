import { useEffect, useRef, useState } from 'react'
import { Alert, ButtonLink, Icon, PageHeader, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { useDocumentTitle, useSetup } from '../lib/setup'
import { usePreferences, type Preferences } from '../lib/preferences'
import Reveal from '../components/Reveal'

interface SettingsData {
  setup: {
    providers: { id: string; label: string; configured: boolean; missing_env: string[] }[]
    browsers: { id: string; label: string; executable: string }[]
    env_present: Record<string, boolean>
    data_dir: string
    limits: {
      max_active_runs: number
      default_max_steps: number
      default_timeout_s: number
      default_headless: boolean
    }
    python: string
    engine: { version: string | null; commit: string | null; upstream: string | null; license: boolean }
  }
  safety: Record<string, string>
}

const ENV_VARS = [
  { name: 'OPENAI_API_KEY', note: 'OpenAI model access' },
  { name: 'ANTHROPIC_API_KEY', note: 'Anthropic model access' },
  { name: 'GOOGLE_API_KEY', note: 'Google Gemini model access' },
  { name: 'BROWSER_USE_API_KEY', note: 'Browser Use gateway + cloud browser' },
  { name: 'VYRA_OPENAI_BASE_URL', note: 'OpenAI-compatible endpoint URL' },
  { name: 'VYRA_OPENAI_API_KEY', note: 'OpenAI-compatible endpoint key' },
]

export default function Settings() {
  useDocumentTitle('Settings & safety')
  const { refresh } = useSetup()
  const { prefs, setPref, reset } = usePreferences()
  const [data, setData] = useState<SettingsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef(0)

  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPref(key, value)
    setSaved(true)
    window.clearTimeout(savedTimer.current)
    savedTimer.current = window.setTimeout(() => setSaved(false), 2000)
  }

  useEffect(() => () => window.clearTimeout(savedTimer.current), [])

  const load = async () => {
    setChecking(true)
    try {
      const [settings] = await Promise.all([api.settings(), refresh()])
      setData(settings)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read server settings.')
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="page">
      <PageHeader
        kicker="Settings & safety"
        title="Configuration lives on the server"
        description="VYRA intentionally has no browser-side key entry. Credentials are read from server/.env at process start, so this page reports presence and names — never values."
        arc="subtle"
        actions={
          <button type="button" className="btn btn--ghost" onClick={() => void load()} disabled={checking}>
            <Icon name="retry" size={16} /> {checking ? 'Re-checking…' : 'Re-check'}
          </button>
        }
      />

      {error && <Alert tone="error" title="Settings unavailable">{error}</Alert>}
      {!data && !error && (
        <div className="loading-row">
          <Spinner /> Reading server settings
        </div>
      )}

      <section className="card preferences">
        <div className="section-head">
          <div>
            <h2>Interface preferences</h2>
            <p>Stored in this browser only. They never change the server's execution limits.</p>
          </div>
          <span className={`save-state ${saved ? 'is-visible' : ''}`} aria-live="polite">
            {saved ? 'Preferences saved' : ''}
          </span>
        </div>
        <div className="pref-grid">
          <label className="switch">
            <input
              type="checkbox"
              checked={prefs.animations}
              onChange={(event) => update('animations', event.target.checked)}
            />
            <span className="switch__track" aria-hidden="true">
              <span />
            </span>
            <span className="switch__text">
              <strong>Interface animations</strong>
              <small>Page transitions, scroll reveals and flip cards. Content stays visible when off.</small>
            </span>
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={prefs.backgroundEffects}
              onChange={(event) => update('backgroundEffects', event.target.checked)}
            />
            <span className="switch__track" aria-hidden="true">
              <span />
            </span>
            <span className="switch__text">
              <strong>Background motion</strong>
              <small>Freezes Glitter Cascade and Fibre Arc on a still frame. Both effects stay visible.</small>
            </span>
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={prefs.defaultHeadless}
              onChange={(event) => update('defaultHeadless', event.target.checked)}
            />
            <span className="switch__track" aria-hidden="true">
              <span />
            </span>
            <span className="switch__text">
              <strong>Start local runs headless</strong>
              <small>Used as the default in the composer; each run can still override it.</small>
            </span>
          </label>
        </div>
        <div className="inline-row">
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => { reset(); setSaved(true); window.clearTimeout(savedTimer.current); savedTimer.current = window.setTimeout(() => setSaved(false), 2000) }}>
            Reset to defaults
          </button>
          <span className="fineprint">The operating system's reduced-motion setting always wins over this preference.</span>
        </div>
      </section>

      {data && (
        <>
          <Reveal className="settings-grid" delay={40}>
            <section className="card">
              <div className="section-head">
                <div>
                  <h2>Server environment</h2>
                  <p>Presence only. Values never leave the server process.</p>
                </div>
              </div>
              <ul className="env-list">
                {ENV_VARS.map((item) => {
                  const present = data.setup.env_present[item.name] ?? false
                  return (
                    <li key={item.name}>
                      <div>
                        <code>{item.name}</code>
                        <small>{item.note}</small>
                      </div>
                      <span className={`env-state ${present ? 'is-set' : ''}`}>{present ? 'present' : 'not set'}</span>
                    </li>
                  )
                })}
              </ul>
              <p className="fineprint">
                Provider keys belong in <code>server/.env</code>, which is git-ignored. Copy <code>server/.env.example</code> and
                fill in only the providers you use. Restart the API after changing it.
              </p>
            </section>

            <section className="card">
              <div className="section-head">
                <div>
                  <h2>Runtime</h2>
                  <p>What the API is actually running</p>
                </div>
              </div>
              <dl className="kv-list kv-list--tight">
                <div>
                  <dt>Engine</dt>
                  <dd>
                    browser-use {data.setup.engine.version ?? 'not installed'}
                  </dd>
                </div>
                <div>
                  <dt>Pinned commit</dt>
                  <dd className="mono">{data.setup.engine.commit ?? '—'}</dd>
                </div>
                <div>
                  <dt>Upstream tree</dt>
                  <dd className="mono">{data.setup.engine.upstream ?? '—'}</dd>
                </div>
                <div>
                  <dt>License file</dt>
                  <dd>{data.setup.engine.license ? 'Present (MIT)' : 'Missing — restore the upstream LICENSE'}</dd>
                </div>
                <div>
                  <dt>Python</dt>
                  <dd>{data.setup.python}</dd>
                </div>
                <div>
                  <dt>Data directory</dt>
                  <dd className="mono break">{data.setup.data_dir}</dd>
                </div>
              </dl>
              <div className="inline-row">
                <span className="pill">{data.setup.limits.max_active_runs} concurrent runs</span>
                <span className="pill">{data.setup.limits.default_max_steps} default steps</span>
                <span className="pill">{data.setup.limits.default_timeout_s}s default timeout</span>
              </div>
              <p className="fineprint">
                Defaults come from environment variables (<code>VYRA_MAX_ACTIVE_RUNS</code>, <code>VYRA_DEFAULT_MAX_STEPS</code>,{' '}
                <code>VYRA_DEFAULT_TIMEOUT_S</code>) and are fixed per process.
              </p>
            </section>
          </Reveal>

          <Reveal as="section" className="card" delay={80}>
            <div className="section-head">
              <div>
                <h2>Safety posture</h2>
                <p>Read this before running tasks against real accounts</p>
              </div>
              <ButtonLink to="/new" variant="quiet" icon="arrow">
                Compose with safeguards
              </ButtonLink>
            </div>
            <div className="safety-grid">
              {Object.entries(data.safety).map(([key, value]) => (
                <div key={key} className="safety-item">
                  <span className="safety-item__icon" aria-hidden="true">
                    <Icon name="shield" size={16} />
                  </span>
                  <div>
                    <h3>{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</h3>
                    <p>{value}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>

          <section className="card card--quiet">
            <h2 className="card__title">Attribution</h2>
            <p className="small">
              VYRA is an independent interface and is not affiliated with or endorsed by Browser Use. The execution engine is the
              open-source <code>browser-use</code> package, pinned at the commit above and kept under its original MIT license in{' '}
              <code>upstream/browser-use/LICENSE</code>. Provider trademarks belong to their owners.
            </p>
            <div className="inline-row">
              <a className="link-quiet" href="https://github.com/browser-use/browser-use" target="_blank" rel="noreferrer">
                browser-use on GitHub <Icon name="external" size={14} />
              </a>
              <span className="muted small">No telemetry is added by VYRA.</span>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
