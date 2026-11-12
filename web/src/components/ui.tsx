import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { STATUS_LABEL, type RunStatus } from '../lib/api'

type IconName =
  | 'pulse'
  | 'plus'
  | 'history'
  | 'browser'
  | 'plug'
  | 'sliders'
  | 'arrow'
  | 'stop'
  | 'retry'
  | 'check'
  | 'alert'
  | 'clock'
  | 'search'
  | 'menu'
  | 'close'
  | 'chevron'
  | 'camera'
  | 'shield'
  | 'external'

const PATHS: Record<IconName, ReactNode> = {
  pulse: <path d="M3 12h4l2-6 3 12 2.5-6H21" />,
  plus: <path d="M12 5v14M5 12h14" />,
  history: <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2" />,
  browser: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M7 6.5h.01M10 6.5h.01" />
    </>
  ),
  plug: <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4" />,
  sliders: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  retry: <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />,
  check: <path d="m5 12 4.5 4.5L19 7" />,
  alert: <path d="M12 8v5M12 16.5h.01M10.3 3.8 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  camera: (
    <>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  shield: <path d="M12 3 5 6v5c0 4.4 3 8 7 10 4-2 7-5.6 7-10V6l-7-3Z" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" />,
}

export function Icon({ name, size = 18, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

export function StatusBadge({ status, small = false }: { status: RunStatus; small?: boolean }) {
  return (
    <span className={`badge status-${status} ${small ? 'badge--sm' : ''}`}>
      <span className="badge__dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'orange' | 'lime' | 'amber' }) {
  return <span className={`pill pill--${tone}`}>{children}</span>
}

export function PageHeader({
  kicker,
  title,
  description,
  actions,
  arc = 'ribbon',
  children,
}: {
  kicker?: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  arc?: 'ribbon' | 'subtle' | 'none'
  children?: ReactNode
}) {
  return (
    <header className={`page-head page-head--${arc}`}>
      <div className="page-head__inner">
        <div className="page-head__copy">
          {kicker && <p className="kicker">{kicker}</p>}
          <h1>{title}</h1>
          {description && <p className="page-head__desc">{description}</p>}
          {children}
        </div>
        {actions && <div className="page-head__actions">{actions}</div>}
      </div>
    </header>
  )
}

export function SectionHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {hint && <p>{hint}</p>}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
  icon = 'pulse',
}: {
  title: string
  body: ReactNode
  action?: ReactNode
  icon?: IconName
}) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} size={22} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action && <div className="empty__action">{action}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function Alert({
  tone = 'error',
  children,
  title,
}: {
  tone?: 'error' | 'warning' | 'info' | 'success'
  children: ReactNode
  title?: string
}) {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'success' ? 'check' : tone === 'error' || tone === 'warning' ? 'alert' : 'shield'} size={18} />
      <div>
        {title && <strong>{title}</strong>}
        <div className="alert__body">{children}</div>
      </div>
    </div>
  )
}

export function ButtonLink({
  to,
  children,
  variant = 'primary',
  icon,
}: {
  to: string
  children: ReactNode
  variant?: 'primary' | 'ghost' | 'quiet'
  icon?: IconName
}) {
  return (
    <Link className={`btn btn--${variant}`} to={to}>
      {children}
      {icon && <Icon name={icon} size={16} />}
    </Link>
  )
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
