// Manual calendar downloads on Admin > Estado (#37): POST /api/admin/status/refresh force-fetches one source or every
// enabled remote one, behind in-memory cooldowns (60 s per source, 120 s for "all"), and GET /status reports them.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { sessionMiddleware, csrfGuard, ensurePassword, loginHandler, hashPassword } from '../auth.js';
import { adminRouter } from '../routes/admin.js';
import { refreshNow, _resetManualRefresh } from '../calendars.js';
import { closeAll } from '../sse.js';
import { loadWebModules } from './webModules.js';

const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', 'UID:r-1', 'DTSTAMP:20261001T000000Z',
  'DTSTART:20261012T100000Z', 'DTEND:20261012T110000Z', 'SUMMARY:Fetched', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');

let ics, app, dir, base, cookie = '';
const hits = { ok: 0, bad: 0, off: 0 };

const call = async (method, url, body, { headers = {}, raw } = {}) => {
  const r = await fetch(base + url, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = r.headers.getSetCookie?.() || [];
  if (set.length) cookie = set.map((x) => x.split(';')[0]).join('; ');
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, headers: r.headers };
};
const refresh = (body, opts) => call('POST', '/api/admin/status/refresh', body, opts);

before(async () => {
  ics = http.createServer((req, res) => {
    if (req.url.startsWith('/ok')) { hits.ok++; res.writeHead(200, { 'content-type': 'text/calendar' }); return res.end(ICS); }
    if (req.url.startsWith('/off')) hits.off++;
    else hits.bad++;
    res.writeHead(500); res.end('boom');
  });
  await new Promise((r) => ics.listen(0, '127.0.0.1', r));
  const u = (p) => `http://127.0.0.1:${ics.address().port}${p}`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-source-refresh-'));
  const c = defaultConfig();
  c.news.feeds = [];
  // no network from the refresher that a manual refresh starts
  for (const s of c.screens) { s.weather.enabled = false; s.news.enabled = false; }
  c.calendar.sources = [
    { id: 'c_ok', type: 'ics', name: 'Ok', url: u('/ok.ics'), enabled: true, refreshMin: 60, color: '#123456', emoji: '', kind: 'generic' },
    { id: 'c_bad', type: 'ics', name: 'Bad', url: u('/bad.ics'), enabled: true, refreshMin: 60, color: '#123456', emoji: '', kind: 'generic' },
    { id: 'c_off', type: 'ics', name: 'Off', url: u('/off.ics'), enabled: false, refreshMin: 60, color: '#123456', emoji: '', kind: 'generic' },
  ];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret123'), passwordIsDefault: false }));
  store.initStore(dir);
  assert.deepEqual(store.getConfig().calendar.sources.map((s) => s.id), ['c_ok', 'c_bad', 'c_off']);
  await ensurePassword();
  const ex = express();
  ex.set('trust proxy', 'loopback');
  ex.use(sessionMiddleware());
  ex.use(express.json({ limit: '1mb' }));
  ex.use(['/api/admin', '/api/auth'], csrfGuard({ multipartPaths: ['/photos'] }));
  ex.post('/api/auth/login', (req, res, next) => loginHandler(req, res).catch(next));
  ex.use('/api/admin', adminRouter());
  ex.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  app = await new Promise((resolve) => { const s = ex.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${app.address().port}`;
});

after(async () => {
  closeAll();
  await new Promise((r) => app.close(r));
  await new Promise((r) => ics.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => _resetManualRefresh());

test('auth and CSRF come first: no fetch without a session or from another origin', async () => {
  assert.equal((await refresh({ sourceId: 'c_ok' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { password: 'secret123' })).status, 200);
  assert.equal((await refresh({ sourceId: 'c_ok' }, { headers: { origin: 'http://evil.example' } })).status, 403);
  const plain = await fetch(base + '/api/admin/status/refresh', { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: '{"sourceId":"c_ok"}' });
  assert.ok(plain.status >= 400 && plain.status < 500, `text/plain refused (${plain.status})`);
  assert.equal(hits.ok, 0);
});

test('one source: forced fetch, fresh status rows, then a per-source cooldown', async () => {
  const r = await refresh({ sourceId: 'c_ok' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.results, [{ id: 'c_ok', result: 'ok', error: null }]);
  assert.equal(hits.ok, 1, 'exactly one fetch');
  const row = r.json.sources.find((s) => s.id === 'c_ok');
  assert.equal(row.ok, true);
  assert.equal(row.count, 1);
  assert.ok(row.refreshAfter, 'the answer already carries the cooldown');
  assert.ok(row.refreshAfterSecs > 55 && row.refreshAfterSecs <= 60, 'and the seconds left, for admins with another clock');

  const again = await refresh({ sourceId: 'c_ok' });
  assert.equal(again.status, 429);
  assert.equal(again.json.error, 'rate_limited');
  assert.ok(again.json.retryAfter >= 1 && again.json.retryAfter <= 60, String(again.json.retryAfter));
  assert.equal(again.headers.get('retry-after'), String(again.json.retryAfter));
  assert.equal(hits.ok, 1, 'no fetch while cooling down');

  const st = (await call('GET', '/api/admin/status')).json;
  assert.ok(st.sources.find((s) => s.id === 'c_ok').refreshAfter);
  assert.equal(st.sources.find((s) => s.id === 'c_bad').refreshAfter, null);
  assert.equal(st.refreshAllAfter, null);
  assert.equal(st.refreshAllAfterSecs, 0);
  assert.equal(st.sources.find((s) => s.id === 'c_bad').refreshAfterSecs, 0);
  assert.equal(st.sources.find((s) => s.id === 'local').refreshAfter, undefined, 'pseudo-sources have no button');
});

test('a failing source reports error with its text', async () => {
  const r = await refresh({ sourceId: 'c_bad' });
  assert.equal(r.status, 200);
  assert.equal(r.json.results.length, 1);
  assert.equal(r.json.results[0].result, 'error');
  assert.ok(r.json.results[0].error);
  assert.equal(r.json.sources.find((s) => s.id === 'c_bad').ok, false);
});

test('all: sources still cooling are skipped, disabled ones are never fetched, then a 120 s cooldown', async () => {
  assert.equal((await refresh({ sourceId: 'c_ok' })).status, 200);
  const okHits = hits.ok;
  const r = await refresh({});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.results.map((x) => x.id), ['c_ok', 'c_bad']);
  const ok = r.json.results[0];
  assert.equal(ok.result, 'cooldown');
  assert.ok(ok.retryAfter > 0);
  assert.equal(r.json.results[1].result, 'error');
  assert.equal(hits.ok, okHits, 'no extra fetch of the cooling source');
  assert.equal(hits.off, 0);
  assert.ok(r.json.refreshAllAfter);
  assert.ok(r.json.refreshAllAfterSecs > 115 && r.json.refreshAllAfterSecs <= 120);

  const again = await refresh({ sourceId: null });
  assert.equal(again.status, 429);
  assert.equal(again.json.error, 'rate_limited');
  assert.ok((await call('GET', '/api/admin/status')).json.refreshAllAfter);
});

test('all: when every source is still cooling nothing is fetched and "all" is not locked', async () => {
  assert.equal((await refresh({ sourceId: 'c_ok' })).status, 200);
  assert.equal((await refresh({ sourceId: 'c_bad' })).status, 200);
  const before = { ...hits };
  const r = await refresh({});
  assert.equal(r.status, 429, JSON.stringify(r.json));
  assert.equal(r.json.error, 'rate_limited');
  assert.ok(r.json.retryAfter >= 1 && r.json.retryAfter <= 60, String(r.json.retryAfter));
  assert.deepEqual(hits, before);
  const st = (await call('GET', '/api/admin/status')).json;
  assert.equal(st.refreshAllAfter, null, 'a refused run does not start the 120 s wait');
});

test('refreshNow: "all" while every source cools answers the soonest wait', async () => {
  const t0 = Date.now();
  assert.equal((await refreshNow({ sourceId: 'c_ok', now: t0 })).results[0].result, 'ok');
  assert.equal((await refreshNow({ sourceId: 'c_bad', now: t0 + 20_000 })).results[0].result, 'error');
  assert.deepEqual(await refreshNow({ now: t0 + 30_000 }), { retryAfter: 30 });
  // c_ok is free again: the run goes ahead, skips c_bad and starts the "all" wait
  const run = await refreshNow({ now: t0 + 60_000 });
  assert.deepEqual(run.results.map((x) => x.result), ['ok', 'cooldown']);
  assert.equal((await refreshNow({ now: t0 + 61_000 })).retryAfter, 119);
});

test('admin helpers: server seconds win over the ISO time, server rows decide the buttons', async () => {
  const [m] = await loadWebModules('/web/admin/sourceRefresh.ts');
  const now = 1_000_000;
  // a server 5 minutes ahead: its ISO time is far off, the seconds are not
  const ahead = new Date(now + 360_000).toISOString();
  assert.deepEqual(m.coolOf({ sources: [{ id: 'a', refreshAfter: ahead, refreshAfterSecs: 60 }], refreshAllAfter: ahead, refreshAllAfterSecs: 120 }, now), { a: now + 60_000, '*': now + 120_000 });
  assert.deepEqual(m.coolOf({ sources: [{ id: 'a', refreshAfter: ahead, refreshAfterSecs: 0 }], refreshAllAfter: null, refreshAllAfterSecs: 0 }, now), {});
  // older or other servers send only the ISO time
  assert.deepEqual(m.coolOf({ sources: [{ id: 'a', refreshAfter: ahead }], refreshAllAfter: null }, now), { a: now + 360_000 });
  assert.deepEqual(m.coolOf({ sources: [{ id: 'a', refreshAfter: ahead, refreshAfterSecs: 'x' }, { id: 'b', refreshAfterSecs: -5 }] }, now), { a: now + 360_000 });
  assert.equal(m.rowRefreshable({ id: 'c_ok', enabled: true }), true);
  assert.equal(m.rowRefreshable({ id: 'c_ok' }), true);
  assert.equal(m.rowRefreshable({ id: 'c_off', enabled: false }), false);
  assert.equal(m.rowRefreshable({ id: 'local', enabled: true }), false);
  assert.equal(m.rowRefreshable({ id: 'birthdays', enabled: true }), false);
  assert.equal(m.allCoolingSecs([]), 0);
  assert.equal(m.allCoolingSecs([{ id: 'a', result: 'cooldown', retryAfter: 40 }, { id: 'b', result: 'ok' }]), 0);
  assert.equal(m.allCoolingSecs([{ id: 'a', result: 'cooldown', retryAfter: 40 }, { id: 'b', result: 'cooldown', retryAfter: 12 }]), 12);
  assert.equal(m.allCoolingSecs([{ id: 'a', result: 'cooldown' }]), 60);
  assert.equal(m.refreshErrorText({ code: 'rate_limited', message: 'Translated' }), 'Translated');
  const generic = m.refreshErrorText({ code: '', message: 'source_disabled' });
  assert.notEqual(generic, 'source_disabled');
  assert.ok(generic.length > 0);
});

test('validation: types, length, pseudo-sources, unknown and disabled sources', async () => {
  const before = { ...hits };
  assert.equal((await refresh({ sourceId: 5 })).status, 400);
  assert.equal((await refresh({ sourceId: '' })).status, 400);
  assert.equal((await refresh({ sourceId: 'x'.repeat(101) })).status, 400);
  for (const id of ['local', 'birthdays']) {
    const r = await refresh({ sourceId: id });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'not_refreshable');
  }
  assert.equal((await refresh({ sourceId: 'nope' })).status, 404);
  const off = await refresh({ sourceId: 'c_off' });
  assert.equal(off.status, 409);
  assert.equal(off.json.error, 'source_disabled');
  assert.equal((await refresh(undefined, { raw: '["c_ok"]' })).status, 400);
  assert.deepEqual(hits, before);
});

test('refreshNow: both cooldowns expire', async () => {
  const t0 = Date.now();
  assert.equal((await refreshNow({ sourceId: 'c_ok', now: t0 })).results[0].result, 'ok');
  assert.equal((await refreshNow({ sourceId: 'c_ok', now: t0 + 30_000 })).retryAfter, 30);
  assert.equal((await refreshNow({ sourceId: 'c_ok', now: t0 + 61_000 })).results[0].result, 'ok');
  assert.ok((await refreshNow({ now: t0 + 61_000 })).results);
  assert.equal((await refreshNow({ now: t0 + 121_000 })).retryAfter, 60);
  const all = await refreshNow({ now: t0 + 182_000 });
  assert.deepEqual(all.results.map((x) => x.result), ['ok', 'error']);
});
