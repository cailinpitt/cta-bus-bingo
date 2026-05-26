// Pure text rendering of a plan + a small native-share helper. The existing
// "Share" copies the URL; this one copies the actual steps so people can paste
// the trip into a message and still tap the link to open the live plan.

import { fmtMin, fmtWalkDistance } from './units.js';

// Multi-line numbered itinerary. Mirrors the on-screen timeline so the shared
// text reads the same as what the user sees.
export function itineraryToText(plan, routes, { start, end } = {}) {
  if (!plan?.legs?.length) return '';
  const totalMin = Math.round(plan.totalSeconds / 60);
  const newCount = plan.newRouteCount ?? 0;
  const lines = [
    `CTA Bus Bingo — ${totalMin} min, ${newCount} new ${newCount === 1 ? 'route' : 'routes'}`,
  ];
  if (start?.label) lines.push(`From: ${start.label}`);
  if (end?.label) lines.push(`To: ${end.label}`);
  lines.push('');
  plan.legs.forEach((l, i) => {
    const route = routes?.[l.rt];
    const isTrain = !!route?.isTrain;
    const routeName = route?.name || '';
    const head = isTrain ? routeName || l.rt : `${l.rt}${routeName ? ` ${routeName}` : ''}`;
    const tag = l.free ? (isTrain ? ' [train connector]' : ' [ridden connector]') : '';
    lines.push(`${i + 1}. ${head}${tag}`);
    if (l.walkFeet > 50) {
      const walkMin = Math.round(l.walkSeconds / 60);
      lines.push(
        `   Walk ${fmtWalkDistance(l.walkFeet)}${walkMin > 0 ? ` (${walkMin} min)` : ''} to ${l.boardStop.stopName}`,
      );
    } else {
      lines.push(`   Board at ${l.boardStop.stopName}`);
    }
    lines.push(`   Ride ${fmtMin(l.rideSeconds)} to ${l.alightStop.stopName}`);
  });
  return lines.join('\n');
}

// Share text via the native share sheet (with the plan URL); fall back to
// copying "text\n\nurl" to the clipboard. Returns 'shared'|'copied'|'cancelled'.
export async function shareText({ text, url, title = 'CTA Bus Bingo' }) {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      // fall through to clipboard
    }
  }
  const payload = url ? `${text}\n\n${url}` : text;
  try {
    await navigator.clipboard.writeText(payload);
    return 'copied';
  } catch {
    return 'cancelled';
  }
}
