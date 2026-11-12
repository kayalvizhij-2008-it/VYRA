import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  resetKey?: string
}

interface State {
  error: Error | null
}

/** Catches render failures so a page error never leaves an empty application. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('VYRA render error:', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <div className="crash">
            <span className="crash__mark" aria-hidden="true">
              !
            </span>
            <p className="kicker">Interface fault</p>
            <h1>This view failed to render</h1>
            <p className="crash__body">
              The run store and the agent are unaffected. Reload the page, or return to the overview and continue from there.
            </p>
            <pre className="crash__detail">{this.state.error.message}</pre>
            <div className="crash__actions">
              <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
                Reload VYRA
              </button>
              <a className="btn btn--ghost" href="/">
                Return to overview
              </a>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
