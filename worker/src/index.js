// Cross-device sync store for CTA Bus Bingo's ridden-routes set.
//
// A dumb key-value blob store: GET/PUT one JSON document per random key. The
// client owns the convergent LWW-Map merge (see src/lib/syncDoc.js), so this
// worker never needs to be smart or hold a lock. The key is an unguessable
// 128-bit bearer capability that addresses exactly one document — there is no
// auth and no per-user state. Data is non-sensitive (which buses you've ridden).

const ALLOWED_ORIGINS = [
  'https://cailinpitt.github.io', // production (GitHub Pages)
  'http://localhost:5173', // vite dev
  'http://localhost:4173', // vite preview
];

const KEY_RE = /^[A-Za-z0-9_-]{22,43}$/; // base64url of 16–32 random bytes
const MAX_BYTES = 16 * 1024;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get('Origin') ?? '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const match = new URL(request.url).pathname.match(/^\/d\/([^/]+)$/);
    if (!match) return json({ error: 'not found' }, 404, cors);
    const key = match[1];
    if (!KEY_RE.test(key)) return json({ error: 'bad key' }, 400, cors);

    if (request.method === 'GET') {
      const doc = await env.SYNC.get(key, 'json');
      return json({ doc: doc ?? null }, 200, cors);
    }

    if (request.method === 'PUT') {
      const body = await request.text();
      if (body.length > MAX_BYTES) return json({ error: 'too large' }, 413, cors);
      try {
        JSON.parse(body); // reject non-JSON before storing
      } catch {
        return json({ error: 'bad json' }, 400, cors);
      }
      await env.SYNC.put(key, body);
      return json({ ok: true }, 200, cors);
    }

    return json({ error: 'method not allowed' }, 405, cors);
  },
};
