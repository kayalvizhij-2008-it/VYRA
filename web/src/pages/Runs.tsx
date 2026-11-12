import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ButtonLink, EmptyState, Icon, PageHeader, StatusBadge } from '../components/ui'
import { SkeletonRows } from '../components/Skeleton'
import Reveal from '../components/Reveal'
import { api, formatRelative, type Run, type RunStats } from '../lib/api'
import { useDocumentTitle } from '../lib/setup'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
] as const

const SORTS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'duration', label: 'Longest run' },
] as const

const PAGE_SIZE = 20

export default function Runs() {
  useDocumentTitle('Run history')
  const [runs, setRuns] = useState<Run[]>([])
  const [stats, setStats] = useState<RunStats | null>(null)
  const [status, setStatus] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('newest')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setLimit(PAGE_SIZE)
  }, [status, debounced])

  useEffect(() => {
    let cancelled = false
    let timer = 0
    const load = async () => {
      try {
        const data = await api.runs(status, debounced, limit)
        if (cancelled) return
        setRuns(data.runs)
        setStats(data.stats)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load run history.')
      } finally {
        if (!cancelled) setLoading(false)
      }
      if (!cancelled) timer = window.setTimeout(load, 6000)
    }
    void load()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [status, debounced, limit, reloadKey])

  const sorted = useMemo(() => {
    const copy = [...runs]
    if (sort === 'oldest') copy.sort((a, b) => a.created_at - b.created_at)
    if (sort === 'duration') copy.sort((a, b) => (b.duration_s ?? -1) - (a.duration_s ?? -1))
    return copy
  }, [runs, sort])

  const counts = stats?.by_status ?? {}
  const total = stats?.total ?? runs.length
  const canLoadMore = runs.length >= limit && limit < 200

  return (
    <div className="page">
      <PageHeader
        kicker="Run history"
        title="Every mission, on the record"
        description="Runs are stored in the server's SQLite database. Search the briefs, filter by state, and open a run to replay its timeline."
        arc="subtle"
        actions={<ButtonLink to="/new" icon="plus">New automation</ButtonLink>}
      />

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Filter runs by status">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={status === filter.id}
              className={`tab ${status === filter.id ? 'is-active' : ''}`}
              onClick={() => setStatus(filter.id)}
            >
              {filter.label}
              {filter.id !== 'all' && counts[filter.id] ? <span>{counts[filter.id]}</span> : null}
            </button>
          ))}
        </div>
        <div className="toolbar__right">
          <label className="search">
            <Icon name="search" size={16} />
            <span className="sr-only">Search run briefs</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search briefs…" />
            {query && (
              <button type="button" className="search__clear" onClick={() => setQuery('')} aria-label="Clear search">
                <Icon name="close" size={13} />
              </button>
            )}
          </label>
          <label className="sort">
            <span className="sr-only">Sort runs</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <p className="list-summary" aria-live="polite">
        Showing {runs.length} of {total} stored run{total === 1 ? '' : 's'}
        {debounced ? ` matching “${debounced}”` : ''}
      </p>

      {error && (
        <div className="inline-error inline-error--action">
          <span>{error}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setReloadKey((v) => v + 1)}>
            <Icon name="retry" size={14} /> Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="card">
          <SkeletonRows rows={5} />
        </div>
      ) : runs.length === 0 ? (
        <EmptyState
          icon="history"
          title="Nothing in this view"
          body={
            debounced || status !== 'all'
              ? 'No runs match this filter. Clear the search or switch status to see everything.'
              : 'No runs have been recorded yet. Compose a mission to create the first one.'
          }
          action={<ButtonLink to="/new">Compose a mission</ButtonLink>}
        />
      ) : (
        <Reveal>
          <div className="table-wrap card">
            <table className="run-table">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Brief</th>
                  <th scope="col">Runtime</th>
                  <th scope="col">Steps</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Created</th>
                  <th scope="col">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <StatusBadge status={run.status} small />
                    </td>
                    <td className="run-table__task">
                      <Link to={`/runs/${run.id}`}>{run.task}</Link>
                    </td>
                    <td>
                      <span className="table-muted">
                        {run.provider} · {run.browser_mode}
                      </span>
                    </td>
                    <td>{run.steps ?? '—'}</td>
                    <td>{run.duration_s != null ? `${run.duration_s.toFixed(1)}s` : '—'}</td>
                    <td>
                      <span className="table-muted">{formatRelative(run.created_at)}</span>
                    </td>
                    <td className="run-table__open">
                      <Link to={`/runs/${run.id}`} aria-label={`Open run: ${run.task.slice(0, 60)}`}>
                        <Icon name="chevron" size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canLoadMore && (
            <div className="load-more">
              <button type="button" className="btn btn--ghost" onClick={() => setLimit((value) => Math.min(value + PAGE_SIZE, 200))}>
                Load more runs
              </button>
              <span>{runs.length} of {total} loaded</span>
            </div>
          )}
        </Reveal>
      )}
    </div>
  )
}
