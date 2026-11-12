import { useCallback, useEffect, useState } from 'react'
import { Alert, ButtonLink, Icon, PageHeader, Spinner } from '../components/ui'
import Reveal from '../components/Reveal'
import { api, type Integrations as IntegrationsData } from '../lib/api'
import { useDocumentTitle } from '../lib/setup'

export default function Integrations() {
  useDocumentTitle('Integrations')
  const [data, setData] = useState<IntegrationsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)

  const copyEnv = async (id: string, names: string[]) => {
    try {
      await navigator.clipboard.writeText(names.join('\n'))
      setCopied(id)
      setCopyError(null)
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 2000)
    } catch {
      setCopyError('Clipboard access was blocked by the browser. The variable names are shown on the card.')
    }
  }

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      setData(await api.integrations())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read integrations.')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="page">
      <PageHeader
        kicker="Tools & integrations"
        title="The engine's real surface"
        description="Everything below is shipped by the pinned browser-use package or detected in the server environment. There are no mock connectors and no placeholder switches."
        arc="subtle"
        actions={
          <button type="button" className="btn btn--ghost" onClick={() => void load()} disabled={refreshing}>
            <Icon name="retry" size={16} /> {refreshing ? 'Checking…' : 'Re-check'}
          </button>
        }
      />

      {error && <Alert tone="error" title="Could not read capabilities">{error}</Alert>}
      {copyError && <Alert tone="warning" title="Copy failed">{copyError}</Alert>}
      {!data && !error && (
        <div className="loading-row">
          <Spinner /> Reading engine capabilities
        </div>
      )}

      {data && (
        <>
          <section className="section-block">
            <div className="section-head">
              <div>
                <h2>Model providers</h2>
                <p>A provider is usable only when its credential is present on the server</p>
              </div>
              <ButtonLink to="/settings" variant="quiet" icon="arrow">
                Env setup
              </ButtonLink>
            </div>
            <Reveal className="provider-grid" delay={60}>
              {data.providers.map((provider) => (
                <article key={provider.id} className={`card provider-card ${provider.configured ? 'is-ready' : ''}`}>
                  <div className="provider-card__head">
                    <h3>{provider.label}</h3>
                    <span className={`badge badge--sm ${provider.configured ? 'status-completed' : 'status-queued'}`}>
                      <span className="badge__dot" />
                      {provider.configured ? 'Configured' : 'Not configured'}
                    </span>
                  </div>
                  <p>{provider.note}</p>
                  <div className="provider-card__models">
                    {provider.models.map((model) => (
                      <code key={model}>{model}</code>
                    ))}
                  </div>
                  {!provider.configured && (
                    <div className="provider-card__footer">
                      <p className="provider-card__env">
                        Add <code>{provider.missing_env.join('</code>, <code>')}</code> to <code>server/.env</code>
                      </p>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => void copyEnv(provider.id, provider.missing_env)}
                      >
                        <Icon name={copied === provider.id ? 'check' : 'external'} size={13} />
                        {copied === provider.id ? 'Copied' : 'Copy variable names'}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </Reveal>
          </section>

          <section className="section-block">
            <div className="section-head">
              <div>
                <h2>Browsers</h2>
                <p>Executed by the engine, not emulated in the page</p>
              </div>
              <ButtonLink to="/profiles" variant="quiet" icon="arrow">
                Open browsers
              </ButtonLink>
            </div>
            <div className="grid-2">
              <article className="card">
                <h3 className="card__title">Local engines detected</h3>
                {data.browsers.length ? (
                  <ul className="plain-list">
                    {data.browsers.map((browser) => (
                      <li key={`${browser.id}-${browser.executable}`}>
                        <Icon name="browser" size={16} />
                        <span>{browser.label}</span>
                        <code>{browser.executable}</code>
                        <span className="badge status-completed badge--sm">
                          <span className="badge__dot" /> Ready
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No Chrome, Chromium or Edge installation found.</p>
                )}
              </article>
              <article className="card">
                <h3 className="card__title">Browser Use Cloud</h3>
                <p className="small muted">
                  A hosted browser with stealth and CAPTCHA handling. {data.cloud.billed ? 'Billed per browser-hour on your Browser Use account.' : ''}
                </p>
                <div className="inline-row">
                  <code>{data.cloud.env}</code>
                  <span className={`badge badge--sm ${data.cloud.available ? 'status-completed' : 'status-queued'}`}>
                    <span className="badge__dot" /> {data.cloud.available ? 'Available' : 'Not configured'}
                  </span>
                </div>
                <p className="fineprint">Cloud runs consume the same model provider as local runs unless Browser Use supplies both.</p>
              </article>
            </div>
          </section>

          <section className="section-block">
            <div className="section-head">
              <div>
                <h2>Engine capabilities</h2>
                <p>Verified against the pinned source tree</p>
              </div>
            </div>
            <Reveal className="tool-grid" delay={80}>
              {data.tools.map((tool) => (
                <article key={tool.id} className="card tool-card">
                  <div className="tool-card__head">
                    <span className="tool-card__mark" aria-hidden="true">
                      <Icon name="plug" size={16} />
                    </span>
                    <h3>{tool.name}</h3>
                  </div>
                  <p>{tool.detail}</p>
                  <code className="tool-card__source">{tool.source}</code>
                </article>
              ))}
            </Reveal>
          </section>

          <section className="card card--quiet">
            <div className="section-head">
              <div>
                <h2>Billing &amp; licensing</h2>
                <p>What is free, and what is not</p>
              </div>
            </div>
            <p className="small">{data.cost_note}</p>
            <dl className="kv-list kv-list--tight">
              <div>
                <dt>Engine</dt>
                <dd>
                  {data.engine.package} {data.engine.version ?? '—'} · MIT
                </dd>
              </div>
              <div>
                <dt>Pinned commit</dt>
                <dd className="mono">{data.engine.commit ?? 'not a git checkout'}</dd>
              </div>
              <div>
                <dt>Upstream path</dt>
                <dd className="mono">{data.engine.upstream ?? '—'}</dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </div>
  )
}
