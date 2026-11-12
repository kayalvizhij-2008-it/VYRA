import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './ui'

interface FlipCardProps {
  title: string
  value: string | number
  caption: string
  icon: 'pulse' | 'check' | 'alert' | 'clock' | 'browser' | 'shield' | 'camera'
  tone?: 'violet' | 'lime' | 'amber' | 'rose'
  backTitle: string
  backBody: ReactNode
  action?: { to: string; label: string }
  delay?: number
}

/**
 * An accessible 3D flip card: click, Enter or Space flips it; the back face holds
 * the extra detail and a real link. Hover only lifts the card, so it never flips
 * away while a control is being clicked, and hidden-face controls are untabbable.
 */
export default function FlipCard({
  title,
  value,
  caption,
  icon,
  tone = 'violet',
  backTitle,
  backBody,
  action,
  delay = 0,
}: FlipCardProps) {
  const [flipped, setFlipped] = useState(false)

  return (
    <div className={`flip flip--${tone} ${flipped ? 'is-flipped' : ''}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="flip__inner">
        <div className="flip__face flip__front" aria-hidden={flipped}>
          <button
            type="button"
            className="flip__toggle"
            onClick={() => setFlipped((v) => !v)}
            aria-expanded={flipped}
            aria-label={`${title}: ${value}. Show details`}
            tabIndex={flipped ? -1 : 0}
          >
            <span className="flip__top">
              <span className="flip__icon" aria-hidden="true">
                <Icon name={icon} size={17} />
              </span>
              <span className="flip__label">{title}</span>
            </span>
            <span className="flip__value">{value}</span>
            <span className="flip__caption">{caption}</span>
            <span className="flip__hint" aria-hidden="true">
              Details <Icon name="chevron" size={13} />
            </span>
          </button>
        </div>

        <div className="flip__face flip__back" aria-hidden={!flipped}>
          <p className="flip__back-kicker">{title}</p>
          <h3>{backTitle}</h3>
          <div className="flip__back-body">{backBody}</div>
          <div className="flip__back-actions">
            {action && (
              <Link to={action.to} className="flip__action" tabIndex={flipped ? 0 : -1}>
                {action.label} <Icon name="arrow" size={13} />
              </Link>
            )}
            <button
              type="button"
              className="flip__back-btn"
              onClick={() => setFlipped(false)}
              tabIndex={flipped ? 0 : -1}
              aria-label={`Return ${title} card to the front`}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
