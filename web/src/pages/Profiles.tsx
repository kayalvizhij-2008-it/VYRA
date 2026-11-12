import { useCallback, useEffect, useState } from 'react'
import { Alert, ButtonLink, Icon, PageHeader } from '../components/ui'
import { SkeletonRows } from '../components/Skeleton'
import Reveal from '../components/Reveal'
import { api } from '../lib/api'
import { useDocumentTitle } from '../lib/setup'

interface ProfilesData {
  engines: { id: string; label: string; available: boolean; executable: string }[]
  modes: { id: string; label: string; description: string; persistent: boolean }[]
  note: string
}

export default function Profiles() {
  useDocumentTitle('Browsers')
  const [data, setData] = useState<ProfilesData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setChecking(true)
    try {
      setData(await api.profiles())
      setError(null)
      setCheckedAt(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read browser capabilities.')
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="page">
      <PageHeader
        kicker="Browsers"
        title="Where the agent runs"
        description="VYRA uses the browser profiles the browser-use engine manages. No cookie jars, saved logins or profile directories are exposed to this interface."
        arc="subtle"
        actions={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => void load()} disabled={checking}>
              <Icon name="retry" size={16} /> {checking ? 'Checking…' : 'Re-check'}
            </button>
            <ButtonLink to="/new" icon="plus">Run with a browser</ButtonLink>
          </>
        }
      />

      {error && (
        <Alert tone="error" title="Capability check failed">
          {error}
          <button type="button" className="btn btn--ghost btn--sm mt-8" onClick={() => void load()}>
            Retry detection
          </button>
        </Alert>
      )}
      {!data && !error && (
        <div className="card">
          <SkeletonRows rows={2} />
        </div>
      )}
      {checkedAt && !checking && <p className="fineprint">Last checked {checkedAt.toLocaleTimeString()}.</p>}

      {data && (
        <>
          <section className="card">
            <div className="section-head">
              <div>
                <h2>Detected engines</h2>
                <p>Found by checking standard install locations on this machine</p>
              </div>
            </div>
            {data.engines.length === 0 ? (
              <div className="shot-empty">
                <Icon name="browser" size={22} />
                <p>No Chromium-family browser was detected.</p>
                <small>Install Google Chrome, Chromium or Microsoft Edge, then restart the API to refresh this list.</small>
              </div>
            ) : (
              <ul className="engine-list">
                {data.engines.map((engine) => (
                  <li key={`${engine.id}-${engine.executable}`}>
                    <span className="engine-list__icon">
                      <Icon name="browser" size={18} />
                    </span>
                    <div>
                      <strong>{engine.label}</strong>
                      <small>{engine.executable} · launched by the engine with a disposable profile</small>
                    </div>
                    <span className="badge status-completed badge--sm">
                      <span className="badge__dot" /> Detected
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Reveal className="mode-cards" delay={80}>
            {data.modes.map((mode) => (
              <article key={mode.id} className="card mode-card">
                <span className="kicker">{mode.persistent ? 'Shared session' : 'Isolated session'}</span>
                <h2>{mode.label}</h2>
                <p>{mode.description}</p>
                <div className="mode-card__facts">
                  <span className="pill">{mode.persistent ? 'uses your logins' : 'fresh profile'}</span>
                  <span className="pill">{mode.id === 'cloud' ? 'billed hourly' : 'local process'}</span>
                </div>
              </article>
            ))}
          </Reveal>

          <Reveal as="section" className="card" delay={120}>
            <div className="section-head">
              <div>
                <h2>Session lifecycle</h2>
                <p>What VYRA stores, and what it deliberately discards</p>
              </div>
            </div>
            <div className="lifecycle">
              <div>
                <span className="lifecycle__step">01</span>
                <h3>Launch</h3>
                <p>Each run gets its own Agent and Browser instance. Local runs create a profile inside the run workspace.</p>
              </div>
              <div>
                <span className="lifecycle__step">02</span>
                <h3>Execute</h3>
                <p>The agent sees the live page and prints one INFO line per step; VYRA stores those lines as timeline events.</p>
              </div>
              <div>
                <span className="lifecycle__step">03</span>
                <h3>Close</h3>
                <p>The browser is closed when the loop ends or you cancel. Temporary profiles are removed with the run.</p>
              </div>
              <div>
                <span className="lifecycle__step">04</span>
                <h3>Retain</h3>
                <p>Only the brief, timeline, result, cost, and screenshots the agent captured are kept in the run store.</p>
              </div>
            </div>
          </Reveal>

          <Alert tone="warning" title="Attached Chrome is a shared session">
            Attaching requires Chrome's remote-debugging port, which has no authentication. Any local process can drive that
            browser while it is enabled. Use it only on a machine you trust, and close that Chrome when you are done. Attached
            mode reuses your existing logins, including any account the agent can reach.
          </Alert>

          <p className="fineprint">{data.note}</p>
        </>
      )}
    </div>
  )
}
