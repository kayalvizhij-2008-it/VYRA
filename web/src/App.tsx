import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useSetup } from './lib/setup'
import { Icon } from './components/ui'
import ErrorBoundary from './components/ErrorBoundary'
import SceneBackground from './components/SceneBackground'
import Overview from './pages/Overview'
import NewRun from './pages/NewRun'
import Runs from './pages/Runs'
import RunDetail from './pages/RunDetail'
import Profiles from './pages/Profiles'
import Integrations from './pages/Integrations'
import Settings from './pages/Settings'
import NotFound from './pages/NotFound'

const NAV = [
  { to: '/', label: 'Overview', icon: 'pulse', end: true },
  { to: '/new', label: 'New automation', icon: 'plus' },
  { to: '/runs', label: 'Run history', icon: 'history' },
  { to: '/profiles', label: 'Browsers', icon: 'browser' },
  { to: '/integrations', label: 'Integrations', icon: 'plug' },
  { to: '/settings', label: 'Settings', icon: 'sliders' },
] as const

function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { setup } = useSetup()
  const configured = setup?.providers.filter((p) => p.configured).length ?? 0
  return (
    <div className={`sidebar__inner ${collapsed ? 'is-collapsed' : ''}`}>
      <Link to="/" className="brand" onClick={onNavigate} aria-label="VYRA overview">
        <span className="brand__mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <path d="M4 22c6-1 8-14 24-14" stroke="url(#g)" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M4 26c8-1 10-14 24-14" stroke="url(#g)" strokeWidth="1.4" opacity=".55" strokeLinecap="round" />
            <path d="M8 18c5-.5 7-10 20-10" stroke="url(#g)" strokeWidth="1" opacity=".35" strokeLinecap="round" />
            <defs>
              <linearGradient id="g" x1="4" y1="26" x2="28" y2="8" gradientUnits="userSpaceOnUse">
                <stop stopColor="#8F7CFF" />
                <stop offset="1" stopColor="#F4F0FF" />
              </linearGradient>
            </defs>
          </svg>
        </span>
        <span className="brand__text">
          <strong>VYRA</strong>
          <small>Browser intelligence</small>
        </span>
      </Link>

      <nav className="nav" aria-label="Primary">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={'end' in item ? item.end : false}
            className={({ isActive }) => `nav__item ${isActive ? 'is-active' : ''}`}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
          >
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__foot">
        <div className={`engine-pill ${configured > 0 ? 'is-ok' : 'is-warn'}`}>
          <span className="engine-pill__dot" aria-hidden="true" />
          <span className="engine-pill__text">
            <strong>{setup?.engine.installed ? `Engine ${setup.engine.version}` : 'Engine offline'}</strong>
            <small>{configured > 0 ? `${configured} provider${configured > 1 ? 's' : ''} ready` : 'No provider configured'}</small>
          </span>
        </div>
        <Link to="/settings" className="sidebar__fine" onClick={onNavigate}>
          browser-use · MIT
        </Link>
      </div>
    </div>
  )
}

function Shell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('vyra.sidebar') === 'collapsed')
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()
  const { setup, error } = useSetup()

  useEffect(() => {
    localStorage.setItem('vyra.sidebar', collapsed ? 'collapsed' : 'expanded')
  }, [collapsed])

  useEffect(() => {
    setDrawer(false)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawer])

  const configured = setup?.providers.some((p) => p.configured) ?? false

  return (
    <div className={`app ${collapsed ? 'app--collapsed' : ''}`}>
      <SceneBackground />
      <aside className="sidebar">
        <Sidebar collapsed={collapsed} />
        <button
          type="button"
          className="sidebar__toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          <Icon name="chevron" size={14} />
        </button>
      </aside>

      <div
        className={`drawer ${drawer ? 'is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        aria-hidden={!drawer}
      >
        <button type="button" className="drawer__scrim" onClick={() => setDrawer(false)} aria-hidden="true" tabIndex={-1} />
        <div className="drawer__panel">
          <button type="button" className="drawer__close" onClick={() => setDrawer(false)} aria-label="Close navigation">
            <Icon name="close" size={18} />
          </button>
          <Sidebar collapsed={false} onNavigate={() => setDrawer(false)} />
        </div>
      </div>

      <main className="main">
        <div className="topbar">
          <button type="button" className="icon-btn topbar__menu" onClick={() => setDrawer(true)} aria-label="Open navigation">
            <Icon name="menu" size={20} />
          </button>
          <div className="topbar__status">
            <span className={`live-dot ${configured ? 'is-ok' : 'is-warn'}`} aria-hidden="true" />
            <span>
              {error
                ? 'Server unreachable'
                : configured
                  ? 'Control plane online'
                  : 'Setup required — no model provider'}
            </span>
          </div>
          <div className="topbar__right">
            <Link to="/new" className="btn btn--primary btn--sm">
              <Icon name="plus" size={16} />
              New automation
            </Link>
          </div>
        </div>
        {error && (
          <div className="app-error" role="alert">
            {error} — is the API running on port 8787?
          </div>
        )}
        <ErrorBoundary resetKey={location.pathname}>
          <div className="route" key={location.pathname}>
            <Outlet />
          </div>
        </ErrorBoundary>
        <footer className="footer">
          <span>VYRA is an independent interface for the open-source browser-use engine.</span>
          <span className="footer__dot" aria-hidden="true" />
          <span>Model inference and cloud browsers are billed by their providers.</span>
        </footer>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Overview />} />
        <Route path="new" element={<NewRun />} />
        <Route path="runs" element={<Runs />} />
        <Route path="runs/:runId" element={<RunDetail />} />
        <Route path="profiles" element={<Profiles />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
