// The To-do page's Google Tasks card (web/admin/caps.ts offersGoogleTasks): self-hosted servers keep offering it with
// Google Calendar and a Google app, as before; Marco Cloud offers it only when its health says features.googleTasks
// for the signed in account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthBody } from '../capabilities.js';
import { loadWebModules } from './webModules.js';

const [capsMod] = await loadWebModules('/web/admin/caps.ts');
const { capsFrom, offersGoogleTasks } = capsMod;

const cloud = (features) => capsFrom({ ok: true, version: '1.0.0', edition: 'cloud', tenancy: 'multi', runtime: 'workers', features });

test('self-hosted: Google Calendar and a Google app, whatever googleTasks says (the server never sends it)', () => {
  const on = capsFrom({ ...healthBody({ version: '0.5.0', env: {} }), features: { ...healthBody({ version: '0.5.0', env: {} }).features, googleCalendar: true } });
  assert.equal('googleTasks' in on.features, false, 'a self-hosted server leaves the key out');
  assert.equal(offersGoogleTasks(on, true), true);
  assert.equal(offersGoogleTasks(on, false), false, 'no Google app (me.googleConfigured)');
  const off = capsFrom({ ...healthBody({ version: '0.5.0', env: {} }), features: { ...healthBody({ version: '0.5.0', env: {} }).features, googleCalendar: false } });
  assert.equal(offersGoogleTasks(off, true), false);
  // a server older than features: everything but the opt-in keys is on
  assert.equal(offersGoogleTasks(capsFrom({ ok: true, version: '0.4.0' }), true), true);
});

test('Marco Cloud: only with features.googleTasks, on top of Google Calendar', () => {
  assert.equal(offersGoogleTasks(cloud({ googleCalendar: true }), true), false, 'a cloud without the key: calendars only');
  assert.equal(offersGoogleTasks(cloud({ googleCalendar: true, googleTasks: false }), true), false);
  assert.equal(offersGoogleTasks(cloud({ googleCalendar: true, googleTasks: true }), true), true);
  assert.equal(offersGoogleTasks(cloud({ googleCalendar: true, googleTasks: true }), false), false);
  assert.equal(offersGoogleTasks(cloud({ googleCalendar: false, googleTasks: true }), true), false);
});
