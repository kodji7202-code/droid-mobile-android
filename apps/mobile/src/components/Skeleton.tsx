interface SkeletonProps {
  /** Number of placeholder lines to render. */
  lines?: number;
  className?: string;
}

/** Shimmering placeholder lines used while content loads. */
export function Skeleton({ lines = 3, className }: SkeletonProps) {
  return (
    <div
      className={`skeleton${className ? ` ${className}` : ''}`}
      data-testid="skeleton"
      aria-hidden="true"
    >
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className="skeleton__line"
          style={{ width: `${100 - (index % 3) * 12}%` }}
        />
      ))}
    </div>
  );
}
