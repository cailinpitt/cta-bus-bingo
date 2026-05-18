// Encode planning context (start, end, cap, round-trip, schedule mode) into
// the URL hash so refreshes restore it and the URL is shareable. Ridden set
// stays in localStorage — private to the user.
//
// Format: #s=<lat>,<lon>,<label>&e=<lat>,<lon>,<label>&c=<cap>&r=<0|1>&m=<now|today>

function encodePoint(p) {
  if (!p) return '';
  const lat = p.lat.toFixed(5);
  const lon = p.lon.toFixed(5);
  const label = encodeURIComponent(p.label ?? '');
  return `${lat},${lon},${label}`;
}

function decodePoint(s) {
  if (!s) return null;
  const [latStr, lonStr, ...rest] = s.split(',');
  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const label = decodeURIComponent(rest.join(',')) || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  return { lat, lon, label };
}

export function readUrlState() {
  if (typeof window === 'undefined') return {};
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return {};
  const params = new URLSearchParams(hash);
  const out = {};
  const start = decodePoint(params.get('s'));
  if (start) out.start = start;
  const end = decodePoint(params.get('e'));
  if (end) out.end = end;
  const cap = parseInt(params.get('c'), 10);
  if (cap >= 1 && cap <= 10) out.cap = cap;
  const r = params.get('r');
  if (r === '0' || r === '1') out.roundTrip = r === '1';
  const m = params.get('m');
  if (m === 'now' || m === 'today') out.scheduleMode = m;
  return out;
}

export function writeUrlState({ start, end, cap, roundTrip, scheduleMode }) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  if (start) params.set('s', encodePoint(start));
  if (end) params.set('e', encodePoint(end));
  if (cap != null) params.set('c', String(cap));
  if (roundTrip != null) params.set('r', roundTrip ? '1' : '0');
  if (scheduleMode) params.set('m', scheduleMode);
  const hash = params.toString();
  const next = hash ? `#${hash}` : '';
  // Replace state — don't push every keystroke into history.
  if (window.location.hash !== next) {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${next}`,
    );
  }
}
