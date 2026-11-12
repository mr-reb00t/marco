// Built event lists are kept while a calendar is unchanged and dropped as soon as it changes (#46).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { setTimeout as sleep } from 'node:timers/promises';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');

const ics = (summary) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', `UID:${summary}-1`,
  'DTSTAMP:20261001T000000Z', 'DTSTART:20261012T100000Z', 'DTEND:20261012T110000Z', `SUMMARY:${summary}`, 'END:VEVENT',
  'END:VCALENDAR', ''].join('\r\n');

const feeds = { a: { status: 200, body: ics('Alpha') }, b: { status: 200, body: ics('Beta') } };
// (a floating time, no TZID: read in the server's time zone)
feeds.f = { status: 200, delay: 0, body: ics('Floating').replace('DTSTART:20261012T100000Z', 'DTSTART:20261012T100000').replace('DTEND:20261012T110000Z', 'DTEND:20261012T110000') };
const W = { from: '2026-10-11', to: '2026-10-13' };
let srv, dir, store, cal;

test.before(async () => {
  srv = http.createServer((req, res) => {
    const f = feeds[req.url.slice(1, 2)];
    setTimeout(() => {
      res.writeHead(f.status, { 'content-type': 'text/calendar' });
      res.end(f.status === 200 ? f.body : 'error');
    }, f.delay || 0);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-memo-'));
  store = await import('../store.js');
  store.initStore(dir);
  cal = await import('../calendars.js');
  const url = (id) => `http://127.0.0.1:${srv.address().port}/${id}.ics`;
  store.updateConfig((c) => {
    c.datetime.timezone = 'UTC';
    c.localEvents.items = [];
    c.birthdays.items = [];
    c.calendar.sources = ['a', 'b'].map((id) => ({ id: `c_${id}`, type: 'ics', name: id, url: url(id), enabled: true,
      refreshMin: 60, color: '#123456', emoji: '', kind: 'generic' }));
  });
});

test.after(() => {
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const src = (id) => store.getConfig().calendar.sources.find((s) => s.id === `c_${id}`);
const refresh = (id) => cal.refreshSource(src(id), { force: true });
const titles = (r) => r.detailed.map((e) => e.title).sort();

test('an unchanged feed keeps the built list', async () => {
  const r1 = await cal.getDetailedEvents(W);
  assert.deepEqual(titles(r1), ['Alpha', 'Beta']);
  await refresh('a');
  const r2 = await cal.getDetailedEvents(W);
  assert.equal(r2.detailed, r1.detailed);
});

test('a failed refresh keeps serving the last good events', async () => {
  const r1 = await cal.getDetailedEvents(W);
  feeds.a.status = 500;
  try {
    await refresh('a');
    const r2 = await cal.getDetailedEvents(W);
    assert.deepEqual(titles(r2), ['Alpha', 'Beta']);
    assert.deepEqual(r2.errors, [{ sourceId: 'c_a', message: 'fetch_failed' }]);
    assert.equal(r2.detailed, r1.detailed);
  } finally {
    feeds.a.status = 200;
    await refresh('a');
  }
});

test('a changed feed is served at once', async () => {
  feeds.a.body = ics('Gamma');
  await refresh('a');
  assert.deepEqual(titles(await cal.getDetailedEvents(W)), ['Beta', 'Gamma']);
});

test('the list of an old feed is let go once the feed changes', async () => {
  let r1 = await cal.getDetailedEvents(W);
  const old = new WeakRef(r1.detailed);
  r1 = null;
  feeds.a.body = ics('Delta');
  await refresh('a');
  assert.deepEqual(titles(await cal.getDetailedEvents(W)), ['Beta', 'Delta']);
  await sleep(0);
  'ab'.match(/a/);
  gc();
  assert.equal(old.deref(), undefined);
});

test('a change in one calendar keeps the lists of the others', async () => {
  const onlyB = { ...W, onlyIds: ['c_b'] };
  const b1 = await cal.getDetailedEvents(onlyB);
  const all1 = await cal.getDetailedEvents(W);
  feeds.a.body = ics('Epsilon');
  await refresh('a');
  assert.equal((await cal.getDetailedEvents(onlyB)).detailed, b1.detailed);
  assert.notEqual((await cal.getDetailedEvents(W)).detailed, all1.detailed);
});

test('an unchanged feed is not written to the disk cache again', async () => {
  const file = fs.readdirSync(path.join(dir, 'cache')).find((f) => f.includes('c_b'));
  assert.ok(file);
  fs.writeFileSync(path.join(dir, 'cache', file), 'mark');
  await refresh('b');
  assert.equal(fs.readFileSync(path.join(dir, 'cache', file), 'utf8'), 'mark');
  feeds.b.body = ics('Zeta');
  await refresh('b');
  assert.match(fs.readFileSync(path.join(dir, 'cache', file), 'utf8'), /Zeta/);
});

test('a time zone change while a download runs: floating times follow the new zone, then and later', async () => {
  const tz = process.env.TZ;
  const onlyF = { ...W, onlyIds: ['c_f'] };
  try {
    process.env.TZ = 'UTC';
    store.updateConfig((c) => {
      c.calendar.sources.push({ ...c.calendar.sources[0], id: 'c_f', name: 'f', url: c.calendar.sources[0].url.replace('/a.ics', '/f.ics') });
    });
    const start = async () => new Date((await cal.getDetailedEvents(onlyF)).detailed[0].start).toISOString();
    assert.equal(await start(), '2026-10-12T10:00:00.000Z');
    feeds.f.delay = 300;
    const p = refresh('f');
    await sleep(50);
    process.env.TZ = 'Europe/Madrid';
    store.updateConfig((c) => void (c.datetime.timezone = 'Europe/Madrid'));
    cal.invalidateIcsParsing();
    await p;
    feeds.f.delay = 0;
    assert.equal(await start(), '2026-10-12T08:00:00.000Z', '10:00 in Madrid');
    await refresh('f');
    assert.equal(await start(), '2026-10-12T08:00:00.000Z', 'and after the next refresh of the same text');
  } finally {
    process.env.TZ = tz;
    store.updateConfig((c) => void (c.datetime.timezone = 'UTC'));
    cal.invalidateIcsParsing();
  }
});
