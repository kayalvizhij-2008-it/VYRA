import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Alert, ButtonLink, Icon, PageHeader, Spinner } from '../components/ui'
import { ApiError, api, type Template } from '../lib/api'
import { useDocumentTitle, useSetup } from '../lib/setup'
import { usePreferences } from '../lib/preferences'

const RISK_TERMS = [
  'buy',
  'purchase',
  'checkout',
  'payment',
  'transfer',
  'delete account',
  'cancel subscription',
  'send email',
  'send message',
  'publish',
  'subscribe',
  'place order',
]

interface LocationState {
  prompt?: string
  title?: string
}

export default function NewRun() {
  useDocumentTitle('New automation')
  const { setup } = useSetup()
  const { prefs } = usePreferences()
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state || {}) as LocationState

  const providers = useMemo(() => setup?.providers ?? [], [setup])
  const configured = providers.filter((p) => p.configured)
  const browserEngines = setup?.browsers ?? []
  const chromeAvailable = browserEngines.some((b) => b.id === 'chrome' || b.id === 'edge')

  const [task, setTask] = useState(state.prompt ?? '')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [browserMode, setBrowserMode] = useState('local')
  const [headless, setHeadless] = useState(prefs.defaultHeadless)
  const [allowed, setAllowed] = useState('')
  const [prohibited, setProhibited] = useState('')
  const [maxSteps, setMaxSteps] = useState(setup?.limits.default_max_steps ?? 60)
  const [timeout, setTimeoutS] = useState(setup?.limits.default_timeout_s ?? 600)
  const [advanced, setAdvanced] = useState(false)
  const [acknowledge, setAcknowledge] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [templateTitle, setTemplateTitle] = useState('')
  const [templateSaved, setTemplateSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [missingEnv, setMissingEnv] = useState<string[]>([])
  const [copiedEnv, setCopiedEnv] = useState(false)

  useEffect(() => {
    if (!provider && configured.length) {
      setProvider(configured[0].id)
      setModel(configured[0].default_model)
    }
  }, [configured, provider])

  useEffect(() => {
    void api
      .templates()
      .then(setTemplates)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (state.prompt) setTask(state.prompt)
  }, [state.prompt])

  useEffect(() => {
    if (!setup) return
    setHeadless(prefs.defaultHeadless)
    setMaxSteps(setup.limits.default_max_steps)
    setTimeoutS(setup.limits.default_timeout_s)
  }, [setup, prefs.defaultHeadless])

  const riskHits = useMemo(() => {
    const lowered = ` ${task.toLowerCase()} `
    return RISK_TERMS.filter((term) => lowered.includes(term))
  }, [task])

  const selectedProvider = providers.find((p) => p.id === provider)
  const selectedReady = Boolean(selectedProvider?.configured)

  const copyProviderEnv = async () => {
    if (!selectedProvider) return
    try {
      await navigator.clipboard.writeText(selectedProvider.missing_env.join('\n'))
      setCopiedEnv(true)
      window.setTimeout(() => setCopiedEnv(false), 2000)
    } catch {
      setError('Clipboard access was blocked. The variable names are shown above.')
    }
  }

  const parseDomains = (value: string) =>
    value
      .split(/[,\n]/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)

  const submit = async () => {
    setError(null)
    setErrorCode(null)
    setMissingEnv([])
    if (!task.trim()) {
      setError('Describe what the agent should accomplish.')
      return
    }
    if (!provider) {
      setError('Choose the model provider you want to run this automation with.')
      return
    }
    if (!selectedReady && selectedProvider) {
      setError(
        `${selectedProvider.label} is not configured on the server. Add ${selectedProvider.missing_env.join(' and ')} to the backend environment, then refresh this page.`,
      )
      setErrorCode('provider_not_configured')
      setMissingEnv(selectedProvider.missing_env)
      return
    }
    if (riskHits.length && !acknowledge) {
      setError('This brief includes a high-impact action. Confirm the acknowledgement before running it.')
      return
    }
    setSubmitting(true)
    try {
      const run = await api.createRun({
        task: task.trim(),
        provider,
        model: model.trim(),
        browser_mode: browserMode,
        headless: browserMode === 'local' ? headless : false,
        allowed_domains: parseDomains(allowed),
        prohibited_domains: parseDomains(prohibited),
        max_steps: maxSteps,
        timeout_s: timeout,
        acknowledge_risk: acknowledge,
      })
      navigate(`/runs/${run.id}`)
    } catch (err) {
      if (err instanceof ApiError && err.detail && typeof err.detail === 'object') {
        const detail = err.detail as { code?: string; flags?: string[]; missing_env?: string[]; message?: string }
        setError(detail.message || err.message)
        setErrorCode(detail.code ?? null)
        setMissingEnv(detail.missing_env ?? [])
      } else {
        setError(err instanceof Error ? err.message : 'Could not start the run.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const saveTemplate = async () => {
    if (!task.trim() || !templateTitle.trim()) return
    setSavingTemplate(true)
    try {
      const created = await api.createTemplate({
        title: templateTitle.trim(),
        prompt: task.trim(),
        category: 'Custom',
      })
      setTemplates((items) => [...items, created])
      setTemplateTitle('')
      setTemplateSaved(true)
      window.setTimeout(() => setTemplateSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the template.')
    } finally {
      setSavingTemplate(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        kicker="New automation"
        title="Compose a mission"
        description="Natural language in, real browser execution out. The agent writes Python against Chrome DevTools Protocol in a persistent REPL."
        arc="subtle"
      />

      {!configured.length && (
        <Alert tone="info" title="No model provider configured yet">
          The composer is fully available without credentials. Pick any provider below — Google is not required. Add that
          provider's key to the backend environment (see <strong>Provider credentials</strong> below or{' '}
          <ButtonLink to="/integrations" variant="quiet">Integrations</ButtonLink>) and the dispatch button unlocks.
        </Alert>
      )}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="composer__main">
          <section className="card">
            <div className="field">
              <label htmlFor="task">Mission brief</label>
              <textarea
                id="task"
                className="textarea textarea--tall"
                value={task}
                onChange={(event) => setTask(event.target.value)}
                placeholder="e.g. Open Hacker News, list the top five stories with their point counts, and return a markdown table."
                maxLength={8000}
                required
              />
              <div className="field__hint">
                <span>{task.trim().length} / 8000 characters</span>
                <span>Be explicit about the target site and the result you want.</span>
              </div>
            </div>

            <div className="template-strip">
              {templates.slice(0, 6).map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="chip"
                  onClick={() => setTask(template.prompt)}
                  title={template.prompt}
                >
                  {template.title}
                </button>
              ))}
            </div>

            {templateSaved ? (
              <p className="fineprint fineprint--ok">
                <Icon name="check" size={14} /> Template saved to the server.
              </p>
            ) : null}
            <details className="save-template">
              <summary>Save this brief as a reusable template</summary>
              <div className="save-template__row">
                <input
                  className="input"
                  placeholder="Template title"
                  value={templateTitle}
                  onChange={(event) => setTemplateTitle(event.target.value)}
                  maxLength={80}
                />
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void saveTemplate()} disabled={savingTemplate}>
                  {savingTemplate ? 'Saving…' : 'Save template'}
                </button>
              </div>
            </details>
          </section>

          <section className="card">
            <h2 className="card__title">Model &amp; runtime</h2>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="provider">Model provider</label>
                <select
                  id="provider"
                  className="select"
                  value={provider}
                  onChange={(event) => {
                    const next = event.target.value
                    setProvider(next)
                    const match = providers.find((p) => p.id === next)
                    setModel(match?.default_model ?? '')
                    setError(null)
                    setErrorCode(null)
                    setMissingEnv([])
                  }}
                >
                  <option value="">Select a provider…</option>
                  {providers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                      {item.configured ? ' — ready' : ' — needs server key'}
                    </option>
                  ))}
                </select>
                {selectedProvider && <p className="field__hint">{selectedProvider.note}</p>}
              </div>
              <div className="field">
                <label htmlFor="model">Model</label>
                <input
                  id="model"
                  className="input"
                  list="provider-models"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={selectedProvider?.default_model ?? 'model id'}
                  maxLength={120}
                />
                <datalist id="provider-models">
                  {(selectedProvider?.models ?? []).map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
                <p className="field__hint">The exact model string sent to the provider. Billing follows that provider.</p>
              </div>
            </div>

            {selectedProvider && (
              <div className={`provider-state ${selectedReady ? 'is-ready' : 'is-missing'}`}>
                <div className="provider-state__head">
                  <span className={`badge badge--sm ${selectedReady ? 'status-completed' : 'status-queued'}`}>
                    <span className="badge__dot" />
                    {selectedReady ? 'Credential present on server' : 'Server credential missing'}
                  </span>
                  <span className="provider-state__env">
                    {selectedProvider.env_keys.map((name) => (
                      <code key={name}>{name}</code>
                    ))}
                  </span>
                </div>
                <p>
                  {selectedReady
                    ? `${selectedProvider.label} is ready. The key stays on the backend and is never sent to this page.`
                    : `Add ${selectedProvider.require_all_env ? selectedProvider.missing_env.join(' and ') : `one of ${selectedProvider.missing_env.join(', ')}`} to the backend host's environment (never to frontend code), then redeploy or restart the API. Any one provider is enough — Google is optional.`}
                </p>
                <div className="inline-row">
                  <ButtonLink to="/integrations" variant="ghost" icon="arrow">
                    Provider setup
                  </ButtonLink>
                  {!selectedReady && (
                    <button type="button" className="btn btn--quiet btn--sm" onClick={() => void copyProviderEnv()}>
                      <Icon name={copiedEnv ? 'check' : 'external'} size={13} />
                      {copiedEnv ? 'Copied variable names' : 'Copy variable names'}
                    </button>
                  )}
                </div>
              </div>
            )}

            <fieldset className="field">
              <legend>Browser mode</legend>
              <div className="mode-grid">
                {[
                  {
                    id: 'local',
                    label: 'Local Chromium',
                    detail: 'Fresh disposable profile',
                    available: browserEngines.length > 0,
                  },
                  {
                    id: 'attached',
                    label: 'Attached Chrome',
                    detail: 'Your open Chrome + logins',
                    available: chromeAvailable,
                  },
                  {
                    id: 'cloud',
                    label: 'Browser Use Cloud',
                    detail: 'Hosted · billed hourly',
                    available: Boolean(setup?.cloud_browser.available),
                  },
                ].map((mode) => (
                  <label
                    key={mode.id}
                    className={`mode ${browserMode === mode.id ? 'is-selected' : ''} ${mode.available ? '' : 'is-disabled'}`}
                  >
                    <input
                      type="radio"
                      name="browser-mode"
                      value={mode.id}
                      checked={browserMode === mode.id}
                      onChange={() => setBrowserMode(mode.id)}
                      disabled={!mode.available}
                    />
                    <span className="mode__body">
                      <strong>{mode.label}</strong>
                      <small>{mode.available ? mode.detail : 'Not available on this server'}</small>
                    </span>
                    <span className="mode__check" aria-hidden="true">
                      <Icon name="check" size={13} />
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {browserMode === 'local' && (
              <label className="switch">
                <input type="checkbox" checked={headless} onChange={(event) => setHeadless(event.target.checked)} />
                <span className="switch__track" aria-hidden="true">
                  <span />
                </span>
                <span className="switch__text">
                  <strong>Headless browser</strong>
                  <small>Turn off to watch the agent work in a visible Chrome window.</small>
                </span>
              </label>
            )}
            {browserMode === 'attached' && (
              <p className="fineprint">
                Attached mode needs remote debugging enabled once at <code>chrome://inspect/#remote-debugging</code>. Chrome may
                ask you to allow the connection.
              </p>
            )}
            {browserMode === 'cloud' && (
              <p className="fineprint">
                Cloud browsers are hosted by Browser Use and billed per browser-hour on your Browser Use account. CAPTCHA solving
                and stealth are part of that service, not this UI.
              </p>
            )}
          </section>

          <section className="card">
            <button type="button" className="disclosure" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
              <span>Advanced controls</span>
              <Icon name="chevron" size={16} className={advanced ? 'is-open' : ''} />
            </button>
            {advanced && (
              <div className="advanced">
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="steps">Max model steps</label>
                    <input
                      id="steps"
                      type="number"
                      min={1}
                      max={200}
                      className="input"
                      value={maxSteps}
                      onChange={(event) => setMaxSteps(Number(event.target.value) || 1)}
                    />
                    <p className="field__hint">Each step is one model request; the last one is delivery-only.</p>
                  </div>
                  <div className="field">
                    <label htmlFor="timeout">Loop timeout (seconds)</label>
                    <input
                      id="timeout"
                      type="number"
                      min={30}
                      max={1700}
                      className="input"
                      value={timeout}
                      onChange={(event) => setTimeoutS(Number(event.target.value) || 30)}
                    />
                    <p className="field__hint">Bounds model requests and REPL cells. Browser start/stop are outside it.</p>
                  </div>
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="allowed">Allowed domains</label>
                    <input
                      id="allowed"
                      className="input"
                      placeholder="example.com, *.example.org"
                      value={allowed}
                      onChange={(event) => setAllowed(event.target.value)}
                    />
                    <p className="field__hint">Host patterns only, comma separated. A guard, not a sandbox.</p>
                  </div>
                  <div className="field">
                    <label htmlFor="prohibited">Prohibited domains</label>
                    <input
                      id="prohibited"
                      className="input"
                      placeholder="bank.example, mail.example"
                      value={prohibited}
                      onChange={(event) => setProhibited(event.target.value)}
                    />
                    <p className="field__hint">Main-frame navigation is blocked; subresources are not filtered.</p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {riskHits.length > 0 && (
            <label className={`risk-box ${acknowledge ? 'is-ack' : ''}`}>
              <input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />
              <span>
                <strong>This brief can make a high-impact change</strong>
                <small>
                  Detected: {riskHits.join(', ')}. The agent can click, type, submit forms and act on signed-in accounts. Review
                  the brief and confirm you want it to proceed.
                </small>
              </span>
            </label>
          )}

          {error && (
            <Alert tone={errorCode === 'confirmation_required' ? 'warning' : 'error'} title="Run not started">
              {error}
              {missingEnv.length > 0 && (
                <p>
                  Missing on the server: <code>{missingEnv.join(', ')}</code>
                </p>
              )}
            </Alert>
          )}

          <div className="composer__submit">
            {selectedReady ? (
              <button type="submit" className="btn btn--primary btn--lg" disabled={submitting}>
                {submitting ? <Spinner label="Submitting" /> : <Icon name="arrow" size={18} />}
                {submitting ? 'Dispatching…' : 'Run automation'}
              </button>
            ) : (
              <ButtonLink to="/integrations" variant="primary" icon="arrow">
                Configure a provider
              </ButtonLink>
            )}
            <p className="fineprint">
              {selectedReady
                ? 'The run starts immediately on the server. You can follow every step and cancel while it executes.'
                : 'You can prepare the brief and browser settings now; the run button unlocks as soon as a server credential is present.'}
            </p>
          </div>
        </div>

        <aside className="composer__rail">
          <div className="brief-panel">
            <div className="brief-panel__body">
              <span className={`badge badge--sm ${selectedReady ? 'status-completed' : 'status-queued'}`}>
                <span className="badge__dot" />
                {selectedReady ? 'Ready to dispatch' : 'Provider setup needed'}
              </span>
              <p className="kicker">Mission profile</p>
              <h2>{task.trim() ? task.trim().split(/\n/)[0].slice(0, 72) : 'Awaiting a brief'}</h2>
              <dl className="kv-list">
                <div>
                  <dt>Provider</dt>
                  <dd>{selectedProvider?.label ?? '—'}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{model || selectedProvider?.default_model || '—'}</dd>
                </div>
                <div>
                  <dt>Browser</dt>
                  <dd>{browserMode === 'local' ? (headless ? 'Local · headless' : 'Local · visible') : browserMode === 'attached' ? 'Attached Chrome' : 'Cloud browser'}</dd>
                </div>
                <div>
                  <dt>Budget</dt>
                  <dd>
                    {maxSteps} steps · {timeout}s
                  </dd>
                </div>
                <div>
                  <dt>Domains</dt>
                  <dd>
                    {parseDomains(allowed).length || parseDomains(prohibited).length
                      ? `${parseDomains(allowed).length} allowed · ${parseDomains(prohibited).length} blocked`
                      : 'No restrictions'}
                  </dd>
                </div>
              </dl>
              <div className="brief-panel__note">
                <Icon name="shield" size={15} />
                <span>The agent runs Python on the server as your user. Treat unknown tasks as code execution.</span>
              </div>
            </div>
          </div>
          <div className="card card--quiet">
            <h3 className="card__title">What happens next</h3>
            <ol className="steps-list">
              <li>
                <span>01</span> The engine resolves the model and starts a browser.
              </li>
              <li>
                <span>02</span> The agent writes Python cells against the live page.
              </li>
              <li>
                <span>03</span> Steps, warnings and screenshots stream into the run workspace.
              </li>
              <li>
                <span>04</span> The final result is stored with usage and reported cost.
              </li>
            </ol>
          </div>
        </aside>
      </form>
    </div>
  )
}
