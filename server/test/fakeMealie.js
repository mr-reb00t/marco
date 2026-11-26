// A small fake Mealie server for the tests (node:http on port 0). It answers the parts of the API Marco uses:
//   GET /api/app/about                          { version } (no token needed)
//   GET /api/users/self                         the token's user (401 without the right Bearer token)
//   GET /api/households/mealplans?start_date&end_date&perPage&page   paged entries within the dates
//   GET /api/media/recipes/<id>/images/min-original.webp            a tiny WebP for recipes with a picture
// `state` can be changed while it runs: version, token, items, down (500), malformed (bad JSON), redirect (302 to
// another host), households (false = Mealie 1.x, 404), pages (force total_pages), images ({ id: Buffer }).
import http from 'node:http';

export const recipeId = (n) => `cccccccc-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
/** A tiny WebP (only the content type matters to Marco). */
export const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBPVP8 fake-image-bytes')]);

let nextId = 1;
/** A meal plan entry in the shape Mealie answers. `recipe`: { n, name, image } or null. */
export function entry(date, entryType, { title = '', text = '', recipe = null, id = nextId++, endDate = null } = {}) {
  const r = recipe ? { id: recipeId(recipe.n), name: recipe.name, slug: String(recipe.name).toLowerCase().replace(/\W+/g, '-'), image: recipe.image ?? null, description: 'x'.repeat(50) } : null;
  return { date, endDate, entryType, title, text, recipeId: r?.id ?? null, id, groupId: 'g', userId: 'u', householdId: 'h', recipe: r };
}

export async function fakeMealie(opts = {}) {
  const state = {
    version: opts.version || 'v3.31.0',
    token: opts.token || 'tok.en-0123456789abcdef',
    items: opts.items || [],
    down: false,
    malformed: false,
    redirect: false,
    households: true,
    pages: null,
    images: opts.images || {},
  };
  const hits = [];
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization || '' });
    const authed = req.headers.authorization === `Bearer ${state.token}`;
    if (state.down) return json(res, 500, { detail: 'boom' });
    if (u.pathname === '/api/app/about') return json(res, 200, { production: true, version: state.version });
    if (u.pathname === '/api/users/self') return authed ? json(res, 200, { id: 'u', username: 'cook' }) : json(res, 401, { detail: 'Could not validate credentials' });
    if (u.pathname === '/api/households/mealplans') {
      if (!state.households) return json(res, 404, { detail: 'Not Found' });
      if (!authed) return json(res, 401, { detail: 'Could not validate credentials' });
      if (state.redirect) {
        res.writeHead(302, { location: 'http://evil.example/steal' });
        return res.end();
      }
      if (state.malformed) return json(res, 200, '{"items": [');
      const from = u.searchParams.get('start_date') || '';
      const to = u.searchParams.get('end_date') || '9999';
      const per = Number(u.searchParams.get('perPage')) || 50;
      const page = Number(u.searchParams.get('page')) || 1;
      const all = state.items.filter((e) => e.date >= from && e.date <= to);
      const pages = state.pages ?? Math.max(1, Math.ceil(all.length / per));
      return json(res, 200, { page, per_page: per, total: all.length, total_pages: pages, items: all.slice((page - 1) * per, page * per), next: null, previous: null });
    }
    const m = /^\/api\/media\/recipes\/([^/]+)\/images\/min-original\.webp$/.exec(u.pathname);
    if (m) {
      const img = state.images[m[1]];
      if (!img) return json(res, 404, { detail: 'Not Found' });
      res.writeHead(200, { 'content-type': 'image/webp' });
      return res.end(img);
    }
    // Mealie's web app answers any other path with its HTML page
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Mealie</title>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    state,
    hits,
    count: (re) => hits.filter((h) => re.test(h.path)).length,
    stop: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
