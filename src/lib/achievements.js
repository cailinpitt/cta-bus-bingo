// Bingo achievements (pure logic; the UI renders/shares them). Count milestones
// live here now; neighborhood ("ride every route in a community area")
// achievements will plug in alongside in a follow-up.

export const COUNT_MILESTONES = [10, 25, 50, 75, 100];

// Count-ridden milestones plus a final "every route" one. `total` is the number
// of bus routes. Each entry: { id, kind, threshold, label, earned, remaining }.
export function countAchievements(riddenCount, total) {
  const out = COUNT_MILESTONES.filter((m) => m < total).map((m) => ({
    id: `count-${m}`,
    kind: 'count',
    threshold: m,
    label: `${m} routes`,
    earned: riddenCount >= m,
    remaining: Math.max(0, m - riddenCount),
  }));
  out.push({
    id: 'count-all',
    kind: 'count',
    threshold: total,
    label: 'Every route',
    earned: total > 0 && riddenCount >= total,
    remaining: Math.max(0, total - riddenCount),
  });
  return out;
}

// Share-card content for a count milestone (pure so it's testable; the caller
// adds chips, footer, and renders to canvas). `ring` drives the donut graphic.
export function countCardContent(threshold, { total, isAll }) {
  if (isAll) {
    return {
      title: 'Full bingo!',
      sub: `Every one of ${total} CTA bus routes — ridden.`,
      ring: { value: total, max: total, big: '✓', label: 'complete' },
    };
  }
  const pct = total > 0 ? Math.round((threshold / total) * 100) : 0;
  return {
    title: `${threshold} routes ridden`,
    sub: `${pct}% of all ${total} CTA bus routes`,
    ring: { value: threshold, max: total, big: String(threshold), label: 'routes' },
  };
}

// Per-community-area achievements: ride every bus route serving the area.
// `areas` is the baked neighborhoods list ({ name, routes, center }).
export function neighborhoodAchievements(ridden, areas) {
  return (areas || []).map((a) => {
    const riddenCount = a.routes.filter((rt) => ridden.has(rt)).length;
    return {
      id: `hood-${a.name}`,
      kind: 'hood',
      name: a.name,
      routes: a.routes,
      total: a.routes.length,
      riddenCount,
      remaining: a.routes.length - riddenCount,
      earned: a.routes.length > 0 && riddenCount === a.routes.length,
    };
  });
}

// Share-card content for a completed community area.
export function neighborhoodCardContent(area) {
  const n = area.routes.length;
  return {
    title: `${area.name} — bingo!`,
    sub: `Rode all ${n} CTA bus route${n === 1 ? '' : 's'} serving ${area.name}`,
    ring: { value: n, max: n, big: String(n), label: 'routes' },
  };
}
