// Free address geocoding via Nominatim, biased to the Chicago area. Cached in
// memory for the session. Adds the required "viewbox" so generic intersections
// like "Belmont & Clark" land in Chicago and not e.g. Belmont, CA.

const CHICAGO_VIEWBOX = '-87.94,42.02,-87.52,41.64'; // left,top,right,bottom
const cache = new Map();

export async function geocode(query) {
  const q = query.trim();
  if (!q) return null;
  if (cache.has(q)) return cache.get(q);

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', `${q}, Chicago, IL`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('viewbox', CHICAGO_VIEWBOX);
  url.searchParams.set('bounded', '1');

  // Nominatim's usage policy requires identifying the app. The browser sends
  // the deployed origin as Referer automatically; that satisfies the policy
  // without exposing personal identifiers to users of the app.
  const res = await fetch(url.toString(), {
    headers: { 'Accept-Language': 'en' },
  });
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  const arr = await res.json();
  if (!arr.length) return null;
  const hit = arr[0];
  const result = {
    lat: parseFloat(hit.lat),
    lon: parseFloat(hit.lon),
    display: hit.display_name,
  };
  cache.set(q, result);
  return result;
}
