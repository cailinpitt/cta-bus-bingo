// Horizontal tab row across the top of the results — one per candidate trip.
// Single-line label so the strip can't collapse to invisibility on narrow viewports.
function fmtMin(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ''}`;
}

export default function TripPicker({ trips, selectedIndex, onSelect }) {
  if (!trips || trips.length <= 1) return null;
  return (
    <div className="rounded-lg border border-gh-border bg-gh-surface p-2">
      <div className="mb-1.5 text-gh-muted text-xs uppercase tracking-wide">
        {trips.length} options
      </div>
      <div className="flex gap-1.5 overflow-x-auto">
        {trips.map((t, i) => (
          <button
            type="button"
            key={i}
            onClick={() => onSelect(i)}
            className={`flex min-h-[44px] shrink-0 flex-col items-start justify-center rounded px-3 py-2 text-left text-sm ${
              i === selectedIndex
                ? 'bg-blue-600 text-white'
                : 'bg-gh-canvas text-gh-muted hover:text-white'
            }`}
          >
            <div className="font-semibold leading-tight">Option {i + 1}</div>
            <div className="text-xs leading-tight opacity-85">
              {t.newRouteCount} new · {fmtMin(t.totalSeconds)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
