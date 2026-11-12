export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton ${className}`.trim()} aria-hidden="true" />
}

export function SkeletonRows({ rows = 4, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`skeleton-rows ${className}`.trim()} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <Skeleton className="skeleton--badge" />
          <Skeleton className="skeleton--line" />
          <Skeleton className="skeleton--meta" />
        </div>
      ))}
    </div>
  )
}
