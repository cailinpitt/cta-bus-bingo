// Cap, round-trip toggle, schedule mode, and the "Plan trip" button.

// Format a Date for a datetime-local input — yyyy-MM-ddTHH:mm in local time.
function toLocalDatetime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Controls({
  cap,
  setCap,
  roundTrip,
  setRoundTrip,
  roundTripDisabled = false,
  scheduleMode,
  setScheduleMode,
  scheduleAt,
  setScheduleAt,
  onPlan,
  busy,
  canPlan,
}) {
  return (
    <div className="rounded-lg border border-gh-border bg-gh-surface p-3 text-sm">
      <div className="mb-2 text-gh-muted text-xs uppercase tracking-wide">Trip</div>

      <label className="mb-3 flex items-center gap-2">
        <span className="text-gh-muted">Max new routes</span>
        <input
          type="number"
          min={1}
          max={10}
          value={cap}
          onChange={(e) => setCap(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
          className="w-16 rounded border border-gh-border bg-gh-canvas px-2 py-1 text-white"
        />
      </label>

      <label
        className={`mb-2 flex items-center gap-2 ${roundTripDisabled ? 'opacity-50' : ''}`}
        title={roundTripDisabled ? 'Clear destination to enable round trip' : undefined}
      >
        <input
          type="checkbox"
          checked={roundTrip && !roundTripDisabled}
          disabled={roundTripDisabled}
          onChange={(e) => setRoundTrip(e.target.checked)}
        />
        <span className="text-gh-muted">Round trip (end near start)</span>
      </label>

      <div className="mb-3">
        <div className="mb-1 text-gh-muted text-xs">Schedule</div>
        <div className="flex gap-1 text-xs">
          {[
            ['now', 'Running now'],
            ['today', 'Running today'],
            ['later', 'Later…'],
          ].map(([k, label]) => (
            <button
              type="button"
              key={k}
              onClick={() => {
                setScheduleMode(k);
                // Seed the picker with "now" the first time the user opens it.
                if (k === 'later' && !scheduleAt) {
                  setScheduleAt?.(toLocalDatetime(new Date()));
                }
              }}
              className={`rounded px-2 py-1 ${
                scheduleMode === k
                  ? 'bg-blue-600 text-white'
                  : 'bg-gh-subtle text-gh-muted hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {scheduleMode === 'later' && (
          <input
            type="datetime-local"
            value={scheduleAt ?? ''}
            onChange={(e) => setScheduleAt?.(e.target.value)}
            className="mt-2 w-full rounded border border-gh-border bg-gh-canvas px-2 py-1 text-white text-xs"
          />
        )}
      </div>

      <button
        type="button"
        onClick={onPlan}
        disabled={!canPlan || busy}
        className="flex w-full items-center justify-center gap-2 rounded bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
      >
        {busy && (
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            role="img"
            aria-label="Loading"
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path
              d="M4 12a8 8 0 018-8"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        )}
        <span>{busy ? 'Planning your trip…' : 'Plan trip'}</span>
      </button>
    </div>
  );
}
