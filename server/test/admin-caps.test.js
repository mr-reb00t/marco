// Admin capabilities (web/admin/caps.ts), the feature filters for the nav, palette and settings search
// (navFilter.ts), validation with features and limits (util.ts validateAll), the sign-in redirects
// (authRedirect.ts), screen URLs (screenUrl.ts) and the generated adminContract.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_KEYS, healthBody } from '../capabilities.js';
import { validateConfig as serverValidate } from '../core/validate.js';
import { CONTRACT_PATH, contractText, generateContract } from '../../scripts/gen-contract.mjs';
import { loadWebModules } from './webModules.js';

const [capsMod, nav, search, util, auth, urls, liveNote, dict, fb] = await loadWebModules(
  '/web/admin/caps.ts',
  '/web/admin/navFilter.ts',
  '/web/admin/searchIndex.ts',
  '/web/admin/util.ts',
  '/web/admin/authRedirect.ts',
  '/web/admin/screenUrl.ts',
  '/web/admin/liveNote.ts',
  '/web/admin/i18n-dict.ts',
  '/web/admin/feedbackForm.ts'
);
const { capsFrom, hasFeature, limitOf, setCaps } = capsMod;

/** The Marco Cloud health block as the plan sets it for the first cloud admin release. */
const cloudHealth = () => {
  const features = {};
  for (const k of FEATURE_KEYS) features[k] = true;
  for (const k of ['homeassistant', 'insecureTls', 'openDisplayAccess', 'passwordLogin', 'includeSecrets', 'setupWizard', 'news', 'gallery', 'apiTokens', 'webhooks', 'googleCalendar', 'googleLogin', 'updates', 'immich', 'twoFactor']) features[k] = false;
  return {
    ok: true,
    uptime: null,
    version: '1.0.0',
    live: 'poll',
    edition: 'cloud',
    tenancy: 'multi',
    runtime: 'workers',
    pairCodeLength: 8,
    features,
    limits: { screens: 6, sources: 10, devices: 12, photos: 500, newsFeeds: 5, apiTokens: 20, backups: 20, customCssBytes: 10240 },
    displayOrigin: 'https://tv.example.com',
  };
};
const selfHosted = () => capsFrom(healthBody({ version: '0.5.0', env: {} }));
const oldServer = () => capsFrom({ ok: true, uptime: 5, version: '0.4.0' });
const cloud = () => capsFrom(cloudHealth());

const baseConfig = () => ({ ...serverValidate({}).value, revision: 1 });

test('caps: old servers and self-hosted keep every feature on', () => {
  const old = oldServer();
  assert.equal(old.edition, 'self-hosted');
  assert.equal(old.features, null);
  // accountMenu, microsoftCalendar, updates, feedback, privacy and the doorbell only exist on servers that say so
  for (const k of FEATURE_KEYS) assert.equal(hasFeature(old, k), !['accountMenu', 'microsoftCalendar', 'updates', 'feedback', 'privacy', 'doorbell', 'doorbellLive', 'carousels', 'immich', 'family', 'widgets', 'webWidgets', 'priceWidgets', 'familyPhotos', 'twoFactor', 'accountSettings', 'screenBuilder', 'spotify'].includes(k), k);
  // carousels: on for this server, off for servers that do not say so (they would drop config.carousels)
  assert.equal(hasFeature(selfHosted(), 'carousels'), true);
  assert.equal(hasFeature(capsFrom({ ok: true, uptime: 1, version: '0.5.0', edition: 'self-hosted', features: { news: true } }), 'carousels'), false);
  assert.equal(old.pairCodeLength, 6);
  assert.equal(old.displayOrigin, null);

  const sh = capsFrom({ ok: true, uptime: 1, version: '0.5.0', edition: 'self-hosted', features: { news: true } });
  assert.equal(hasFeature(sh, 'gallery'), true, 'a missing key is on in self-hosted');
  assert.equal(hasFeature(sh, 'accountMenu'), false, 'the account menu is never on by default');
  assert.equal(hasFeature(sh, 'microsoftCalendar'), false, 'nor are Microsoft calendars unless the server says so');
  assert.equal(hasFeature(capsFrom({ ...cloudHealth(), features: { ...cloudHealth().features, microsoftCalendar: true } }), 'microsoftCalendar'), true);
  assert.equal(hasFeature(sh, 'updates'), false, 'a self-hosted server that does not list updates has no update endpoints');
  assert.equal(hasFeature(selfHosted(), 'updates'), true);
  assert.equal(hasFeature(sh, 'feedback'), false, 'the feedback form is never on unless the server says so');
  assert.equal(hasFeature(selfHosted(), 'feedback'), false, 'a self-hosted server has no feedback form');
  assert.equal(hasFeature(selfHosted(), 'doorbell'), true);
  assert.equal(hasFeature(selfHosted(), 'doorbellLive'), true);
  assert.equal(hasFeature(sh, 'doorbell'), false, 'an older self-hosted server has no doorbell hook');
  assert.equal(hasFeature(selfHosted(), 'immich'), true);
  assert.equal(hasFeature(sh, 'immich'), false, 'an older self-hosted server has no Immich proxy');
  assert.equal(hasFeature(cloud(), 'immich'), false, 'Marco Cloud has no Immich');
  assert.equal(hasFeature(capsFrom({ ...cloudHealth(), features: { news: true } }), 'immich'), false, 'a missing key is off');
  // "now playing" with Spotify: only on servers that link a Spotify app (an older one has no /api/admin/spotify)
  assert.equal(hasFeature(selfHosted(), 'spotify'), true);
  assert.equal(hasFeature(sh, 'spotify'), false, 'an older self-hosted server has no Spotify accounts');
  const sh2 = capsFrom({ ok: true, uptime: 1, version: '0.5.0', edition: 'self-hosted', features: { news: false } });
  assert.equal(hasFeature(sh2, 'news'), false, 'an explicit false is off everywhere');
});

test('caps: cloud reads features, limits, pairing length and display origin', () => {
  const c = cloud();
  assert.equal(c.edition, 'cloud');
  assert.equal(c.runtime, 'workers');
  assert.equal(c.live, 'poll');
  assert.equal(c.pairCodeLength, 8);
  assert.equal(c.uptime, null);
  assert.equal(c.displayOrigin, 'https://tv.example.com');
  assert.equal(hasFeature(c, 'homeassistant'), false);
  assert.equal(hasFeature(c, 'activity'), true);
  const missing = capsFrom({ ...cloudHealth(), features: { news: true } });
  assert.equal(hasFeature(missing, 'gallery'), false, 'a missing key is off outside self-hosted');
  assert.equal(limitOf(c, 'screens'), 6);
  assert.equal(limitOf(c, 'devices'), 12);
  assert.equal(limitOf(c, 'birthdays'), 500, 'validator cap when the plan sets none');
  assert.equal(limitOf(selfHosted(), 'screens'), 12, 'self-hosted keeps the validator cap');
  assert.equal(limitOf(selfHosted(), 'photos'), null, 'no limit');
  // a plan limit never raises the validator cap
  assert.equal(limitOf(capsFrom({ ...cloudHealth(), limits: { screens: 50 } }), 'screens'), 12);
});

test('caps: odd health values fall back to safe defaults', () => {
  const c = capsFrom({ edition: 'cloud', pairCodeLength: 99, displayOrigin: 'javascript:alert(1)', limits: { screens: -1, sources: 'x' } });
  assert.equal(c.pairCodeLength, 6);
  assert.equal(c.displayOrigin, null);
  assert.deepEqual(c.limits, {});
  assert.equal(capsFrom({ displayOrigin: 'https://tv.example.com/some/path' }).displayOrigin, 'https://tv.example.com');
  assert.equal(capsFrom(null).edition, 'self-hosted');
});

test('caps: loadCaps keeps everything on when /api/health cannot be read', async () => {
  const c = await capsMod.loadCaps(async () => {
    throw new Error('network');
  });
  assert.equal(c.features, null);
  assert.equal(capsMod.has('news'), true);
  await capsMod.loadCaps(async () => cloudHealth());
  assert.equal(capsMod.has('news'), false);
  assert.equal(capsMod.atLimit('screens', 6), true);
  assert.equal(capsMod.atLimit('screens', 5), false);
  setCaps(capsFrom(null));
});

test('navFilter: cloud caps hide news, photos, Home Assistant and the API page', () => {
  const ids = nav.filterNav(nav.NAV_ITEMS, cloud()).map((n) => n.id);
  for (const hidden of ['news', 'photos', 'homeassistant', 'api', 'immich']) assert.ok(!ids.includes(hidden), hidden);
  for (const shown of ['home', 'screen', 'calendars', 'alerts', 'displays', 'backups', 'activity', 'security', 'status']) assert.ok(ids.includes(shown), shown);
});

test('navFilter: self-hosted defaults and old servers show everything', () => {
  const all = nav.NAV_ITEMS.map((n) => n.id);
  assert.deepEqual(nav.filterNav(nav.NAV_ITEMS, selfHosted()).map((n) => n.id), all);
  // old servers have no carousels page (opt-in: it would drop the section on save), no Immich proxy and no Familia
  assert.deepEqual(nav.filterNav(nav.NAV_ITEMS, oldServer()).map((n) => n.id), all.filter((id) => !['carousels', 'immich', 'family', 'meals', 'widgets', 'spotify'].includes(id)));
  const routes = all;
  // every entry except the account ones (features.accountMenu, multi-tenant servers only), Microsoft calendars
  // (features.microsoftCalendar), updates (features.updates) and the doorbell (features.doorbell): an old server lists
  // none of them
  const accountEntries = search.SETTINGS_INDEX.filter((e) => e.feature === 'accountMenu' || e.feature === 'accountSettings' || e.feature === 'microsoftCalendar').length;
  assert.equal(accountEntries, 7);
  // updates, privacy mode and the doorbell are opt-in too (features.updates, features.privacy, features.doorbell)
  const updateEntries = search.SETTINGS_INDEX.filter((e) => e.feature === 'updates' || e.feature === 'privacy').length;
  assert.equal(updateEntries, 2);
  const doorbellEntries = search.SETTINGS_INDEX.filter((e) => e.feature === 'doorbell').length;
  assert.equal(doorbellEntries, 2);
  const carouselEntries = search.SETTINGS_INDEX.filter((e) => e.feature === 'carousels').length;
  assert.equal(carouselEntries, 1);
  const immichEntries = search.SETTINGS_INDEX.filter((e) => e.feature === 'immich').length;
  assert.equal(immichEntries, 1);
  const familyEntries = search.SETTINGS_INDEX.filter((e) => e.feature === 'family').length;
  assert.equal(familyEntries, 8);
  const widgetEntries = search.SETTINGS_INDEX.filter((e) => e.feature === 'widgets').length;
  assert.equal(widgetEntries, 1);
  // two-step sign-in: older servers have no /api/admin/2fa
  const twoFactorEntries = search.SETTINGS_INDEX.filter((e) => [e.feature].flat().includes('twoFactor')).length;
  assert.equal(twoFactorEntries, 1);
  // "now playing" with Spotify: older servers have no /api/admin/spotify
  const spotifyEntries = search.SETTINGS_INDEX.filter((e) => e.feature === 'spotify').length;
  assert.equal(spotifyEntries, 2);
  assert.equal(nav.filterSettings(search.SETTINGS_INDEX, oldServer(), routes).length, search.SETTINGS_INDEX.length - accountEntries - updateEntries - doorbellEntries - carouselEntries - immichEntries - familyEntries - widgetEntries - twoFactorEntries - spotifyEntries);
  // without Google credentials a self-hosted admin still lists the Google entries (with the setup hint); the doorbell
  // card is on the Home Assistant page there, so the entry for API & webhooks (servers without a live camera) is out
  const snapshotEntries = search.SETTINGS_INDEX.filter((e) => e.unless === 'doorbellLive').length;
  assert.equal(snapshotEntries, 1);
  assert.equal(nav.filterSettings(search.SETTINGS_INDEX, selfHosted(), routes).length, search.SETTINGS_INDEX.length - accountEntries - snapshotEntries);
  // every action except the feedback form (Marco Cloud only)
  const actions = Object.keys(nav.ACTION_FEATURES).map((id) => ({ id }));
  assert.deepEqual(nav.filterActions(actions, selfHosted()).map((a) => a.id), actions.map((a) => a.id).filter((id) => id !== 'a-feedback'));
  assert.ok(!nav.filterActions(actions, oldServer()).some((a) => a.id === 'a-feedback'));
});

test('doorbell search: a server without a live camera finds the card on API & webhooks', () => {
  const h = cloudHealth();
  Object.assign(h.features, { apiTokens: true, webhooks: true, doorbell: true, doorbellLive: false });
  const c = capsFrom(h);
  const routes = nav.filterNav(nav.NAV_ITEMS, c).map((n) => n.id);
  assert.ok(!routes.includes('homeassistant'));
  const found = nav.filterSettings(search.SETTINGS_INDEX, c, routes).filter((e) => e.feature === 'doorbell');
  assert.deepEqual(found.map((e) => `${e.route}/${e.anchor}`), ['api/api-doorbell']);
  // the same server with a live camera (self-hosted) keeps the card on the Home Assistant page
  const sh = nav.filterSettings(search.SETTINGS_INDEX, selfHosted(), nav.NAV_ITEMS.map((n) => n.id)).filter((e) => e.feature === 'doorbell');
  assert.deepEqual(sh.map((e) => `${e.route}/${e.anchor}`), ['homeassistant/ha-doorbell']);
});

test('feedback: self-hosted never offers it, the cloud does when it says so', () => {
  assert.equal(healthBody({ version: '0.5.0', env: {} }).features.feedback, false);
  assert.equal(hasFeature(selfHosted(), 'feedback'), false);
  assert.equal(hasFeature(oldServer(), 'feedback'), false);
  assert.equal(hasFeature(cloud(), 'feedback'), true);
  assert.equal(hasFeature(capsFrom({ ...cloudHealth(), features: { ...cloudHealth().features, feedback: undefined } }), 'feedback'), false);
  const actions = ['a-feedback', 'a-view'].map((id) => ({ id }));
  assert.deepEqual(nav.filterActions(actions, cloud()).map((a) => a.id), ['a-feedback', 'a-view']);
  assert.deepEqual(nav.filterActions(actions, selfHosted()).map((a) => a.id), ['a-view']);
  assert.equal(generateContract().endpoints.find((e) => e.path === '/api/admin/feedback').feature, 'feedback');
});

test('feedback form: limits, the details it sends and nothing else', () => {
  const meta = fb.feedbackMeta({ version: ' 0.5.1 ', page: 'calendars', screens: 2, userAgent: 'UA/1.0', lang: 'es', timeZone: 'Europe/Lisbon', extra: 'x' });
  assert.deepEqual(meta, { version: '0.5.1', page: 'calendars', screens: 2, userAgent: 'UA/1.0', lang: 'es', timeZone: 'Europe/Lisbon' });
  assert.deepEqual(fb.metaRows(meta).map(([k]) => k), ['Versión', 'Página', 'Pantallas', 'Idioma', 'Zona horaria', 'Navegador']);
  assert.deepEqual(fb.feedbackMeta({ screens: -1, userAgent: 'x'.repeat(500) }), { userAgent: 'x'.repeat(300) });
  assert.equal(fb.messageError('  ab '), 'Escribe un poco más para que podamos entenderlo.');
  assert.equal(fb.messageError('It broke'), '');
  assert.equal(fb.messageError('x'.repeat(fb.FEEDBACK_MAX + 1)), 'El mensaje es demasiado largo.');
  assert.deepEqual(fb.feedbackBody('idea', '  More colors ', meta, true), { kind: 'idea', message: 'More colors', meta });
  assert.deepEqual(fb.feedbackBody('problem', 'Broken', meta, false), { kind: 'problem', message: 'Broken', meta: null });
  assert.equal(fb.feedbackBody('weird', 'Hi there', meta, false).kind, 'other');
  assert.equal(fb.GITHUB_ISSUES_URL, 'https://github.com/mr-reb00t/marco/issues/new/choose');
  // every label and message of the form is translated
  for (const k of ['Ayuda y comentarios', 'Problema', 'Idea', 'Otra cosa', 'Abrir un issue en GitHub', 'Gracias, lo leeremos.', ...fb.metaRows(meta).map(([k]) => k), fb.messageError(''), fb.messageError('x'.repeat(fb.FEEDBACK_MAX + 1))]) {
    assert.ok(dict.EN[k], k);
    assert.ok(dict.PT[k], k);
  }
});

test('navFilter: palette and settings search follow the features', () => {
  const c = cloud();
  const visible = nav.filterNav(nav.NAV_ITEMS, c).map((n) => n.id);
  const labels = nav.filterSettings(search.SETTINGS_INDEX, c, visible).map((s) => s.label);
  for (const gone of ['Emails de Google permitidos', 'Sensores de Home Assistant para el tiempo', 'Fuentes de noticias (RSS)', 'Tokens de API', 'Galería de fotos', 'Acceso a las pantallas', 'Cuentas de Google Calendar', 'Cerrar sesión en todos los dispositivos']) {
    assert.ok(!labels.includes(gone), gone);
  }
  assert.ok(labels.includes('CSS personalizado'));
  assert.ok(labels.includes('Exportar configuración'));
  // the account settings (features.accountSettings) bring their own password, two-step and session entries
  for (const kept of ['Cambiar contraseña', 'Verificación en dos pasos', 'Sesiones abiertas', 'Eliminar cuenta']) assert.ok(labels.includes(kept), kept);
  const noSettings = capsFrom({ ...cloudHealth(), features: { ...cloudHealth().features, accountSettings: false } });
  const older = nav.filterSettings(search.SETTINGS_INDEX, noSettings, visible).map((s) => s.label);
  for (const gone of ['Cambiar contraseña', 'Verificación en dos pasos', 'Sesiones abiertas', 'Eliminar cuenta']) assert.ok(!older.includes(gone), gone);
  for (const s of search.SETTINGS_INDEX) assert.ok(nav.NAV_ITEMS.some((n) => n.id === s.route), `unknown route ${s.route}`);

  const noCmds = capsFrom({ ...cloudHealth(), features: { ...cloudHealth().features, displayCommands: false } });
  const kept = nav.filterActions(['a-refresh', 'a-identify', 'a-night-on', 'a-pair', 'a-view'].map((id) => ({ id })), noCmds).map((a) => a.id);
  assert.deepEqual(kept, ['a-pair', 'a-view']);
  assert.equal(nav.routeFor('news', nav.filterNav(nav.NAV_ITEMS, c)), 'home');
  assert.equal(nav.routeFor('calendars', nav.filterNav(nav.NAV_ITEMS, c)), 'calendars');
});

test('validateAll: the password rule applies only with password login', () => {
  const cfg = baseConfig();
  cfg.auth = { ...cfg.auth, passwordLoginEnabled: false, allowedGoogleEmails: [] };
  assert.ok('auth.passwordLoginEnabled' in util.validateAll(cfg, selfHosted()).global);
  assert.ok('auth.passwordLoginEnabled' in util.validateAll(cfg, oldServer()).global);
  const r = util.validateAll(cfg, cloud());
  assert.ok(!('auth.passwordLoginEnabled' in r.global));
  assert.equal(r.total, 0, JSON.stringify(r));
});

test('validateAll: a calendar URL the server kept back (urlHidden) may stay empty, a typed one is checked', () => {
  const cfg = baseConfig();
  const src = { id: 'c_hidden', type: 'ics', name: 'Family', url: '', urlHidden: true, color: '#336699', emoji: '', kind: 'generic', enabled: true, refreshMin: 30 };
  cfg.calendar.sources = [src];
  assert.equal(util.validateAll(cfg, cloud()).total, 0);
  cfg.calendar.sources = [{ ...src, url: 'not a url' }];
  assert.ok(util.validateAll(cfg, cloud()).total > 0);
  cfg.calendar.sources = [{ ...src, urlHidden: false }];
  assert.ok(util.validateAll(cfg, cloud()).total > 0);
  // The server never keeps the flag.
  const saved = serverValidate({ ...cfg, calendar: { ...cfg.calendar, sources: [{ ...src, url: 'https://example.com/a.ics' }] } });
  assert.ok(saved.ok);
  assert.ok(!('urlHidden' in saved.value.calendar.sources[0]));
});

test('validateAll: Home Assistant rules apply only with the feature', () => {
  const cfg = baseConfig();
  cfg.homeassistant = { ...cfg.homeassistant, enabled: true, url: 'not a url' };
  cfg.weather = { ...cfg.weather, enabled: true, provider: 'homeassistant', haWeatherEntity: '' };
  const sh = util.validateAll(cfg, selfHosted());
  assert.ok('homeassistant.url' in sh.global);
  assert.ok('weather.haWeatherEntity' in sh.global);
  const cl = util.validateAll(cfg, cloud());
  assert.ok(!('homeassistant.url' in cl.global));
  assert.ok(!('weather.haWeatherEntity' in cl.global));
});

test('validateAll: carousels need a name, a free address, a screen and 10 s to 1 h per step', () => {
  const cfg = baseConfig();
  cfg.carousels = {
    items: [
      { id: 'v_a', enabled: true, name: '', slug: cfg.screens[0].slug, transition: 'fade', holdOnAlert: true, nightRotate: false, offScreenId: null, schedule: [{ id: 'p_1', enabled: true, days: [], from: '08:00', to: '08:00' }], steps: [{ screenId: cfg.screens[0].id, seconds: 5 }] },
      { id: 'v_b', enabled: true, name: 'B', slug: 'loop', transition: 'fade', holdOnAlert: true, nightRotate: false, offScreenId: null, schedule: [], steps: [] },
      { id: 'v_c', enabled: false, name: 'C', slug: 'loop', transition: 'none', holdOnAlert: true, nightRotate: false, offScreenId: null, schedule: [], steps: [] },
    ],
  };
  const g = util.validateAll(cfg, selfHosted()).global;
  assert.ok(g['car.v_a.name']);
  assert.ok(g['car.v_a.slug'], 'a screen already uses the address');
  assert.ok(g['car.v_a.step0.seconds']);
  assert.ok(g['car.v_a.sched.p_1.to']);
  assert.ok(g['car.v_b.steps'], 'an enabled carousel needs a screen');
  assert.ok(!g['car.v_c.steps'], 'a paused one may be empty');
  assert.ok(g['car.v_c.slug'], 'two carousels cannot share an address');
  assert.ok(g[`scr.${cfg.screens[0].id}.slug`], 'the screen is flagged too');
  assert.equal(util.sectionForError('car.v_a.name'), 'carousels');
  assert.equal(util.sectionForServerPath('carousels.items[0].slug').section, 'carousels');
  // the Spanish keys have English and Portuguese rows
  for (const k of Object.values(g)) assert.ok(k in dict.EN && k in dict.PT, k);
});

test('validateAll: going over a limit is flagged', () => {
  const cfg = baseConfig();
  const screen = cfg.screens[0];
  cfg.screens = Array.from({ length: 7 }, (_, i) => ({ ...structuredClone(screen), id: `s_${i}`, slug: `screen-${i}`, name: `Screen ${i}` }));
  cfg.calendar.sources = Array.from({ length: 11 }, (_, i) => ({ id: `c${i}`, type: 'ics', name: `Cal ${i}`, url: `https://example.com/${i}.ics`, color: '#336699', emoji: '', kind: 'generic', enabled: true, refreshMin: 30 }));
  cfg.screens[0].screen.customCss = 'a{}'.repeat(4000);

  const cl = util.validateAll(cfg, cloud());
  assert.equal(cl.global['limit.screens'], util.LIMIT_EXCEEDED);
  assert.equal(cl.global['limit.sources'], util.LIMIT_EXCEEDED);
  assert.equal(cl.screens.s_0['screen.customCss'], util.LIMIT_EXCEEDED);
  assert.equal(util.sectionForError('limit.screens'), 'screens');
  assert.equal(util.sectionForError('limit.sources'), 'calendars');
  assert.equal(util.sectionForError('limit.newsFeeds'), 'news');

  const sh = util.validateAll(cfg, selfHosted());
  assert.ok(!('limit.screens' in sh.global), '7 screens are fine self-hosted');
  assert.ok(!('limit.sources' in sh.global));
  assert.ok(!('screen.customCss' in sh.screens.s_0), 'no CSS cap self-hosted');

  cfg.screens = Array.from({ length: 13 }, (_, i) => ({ ...structuredClone(screen), id: `s_${i}`, slug: `screen-${i}`, name: `Screen ${i}` }));
  assert.equal(util.validateAll(cfg, selfHosted()).global['limit.screens'], util.LIMIT_EXCEEDED, 'the validator cap applies everywhere');
});

test('authRedirect: account mode goes to the login page with next', () => {
  const me = { user: { email: 'a@example.com', name: 'A', method: 'account' }, googleConfigured: false, passwordLoginEnabled: false, account: { loginUrl: '/login', accountUrl: '/account', sessionsUrl: '/account/sessions', deleteUrl: '/account/delete', household: { name: 'Home', role: 'owner' } } };
  assert.equal(auth.authRedirect(me, cloud(), '/admin/#/calendars'), `/login?next=${encodeURIComponent('/admin/#/calendars')}`);
  assert.equal(auth.authRedirect({ user: null, googleConfigured: false, passwordLoginEnabled: false }, cloud(), '/admin/'), `/login?next=${encodeURIComponent('/admin/')}`);
  assert.equal(auth.authRedirect(me, cloud(), 'https://evil.example/admin/'), `/login?next=${encodeURIComponent('/admin/')}`);
  assert.equal(auth.authRedirect(me, cloud(), '/admin//evil.example'), `/login?next=${encodeURIComponent('/admin/')}`);
  assert.equal(auth.authRedirect({ user: null, googleConfigured: false, passwordLoginEnabled: true }, selfHosted(), '/admin/'), null);
  assert.equal(auth.logoutRedirect(me, cloud(), { ok: true, next: '/goodbye' }), '/goodbye');
  assert.equal(auth.logoutRedirect(me, cloud(), { next: '//evil.example' }), '/login');
  // browsers drop tabs and newlines in URLs, so these would become "//evil.example"
  assert.equal(auth.logoutRedirect(me, cloud(), { next: '/\t/evil.example' }), '/login');
  assert.equal(auth.logoutRedirect(me, cloud(), { next: '/\n/evil.example' }), '/login');
  assert.equal(auth.logoutRedirect(me, cloud(), { next: '/\\evil.example' }), '/login');
  assert.equal(auth.authRedirect(me, cloud(), '/admin/\t/x'), `/login?next=${encodeURIComponent('/admin/')}`);
  assert.equal(auth.logoutRedirect({ user: { email: '', name: '', method: 'password' }, googleConfigured: false, passwordLoginEnabled: true }, selfHosted(), {}), null);
});

const accountMe = (account = {}) => ({
  user: { email: 'a@example.com', name: 'A', method: 'account' },
  googleConfigured: false,
  passwordLoginEnabled: false,
  account: { loginUrl: '/login', accountUrl: '/account', sessionsUrl: '/account/sessions', deleteUrl: '/account/delete', household: { name: 'Home', role: 'owner' }, ...account },
});

test('authRedirect(me, caps): who is in account mode', () => {
  const pw = { user: { email: '', name: 'Admin', method: 'password' }, googleConfigured: false, passwordLoginEnabled: true };
  const google = { user: { email: 'g@example.com', name: 'G', method: 'google' }, googleConfigured: true, passwordLoginEnabled: true };
  // self-hosted: password and Google logins keep the admin's own login screen, before and after a 401
  for (const caps of [selfHosted(), oldServer()]) {
    assert.equal(auth.accountMode(pw, caps), false);
    assert.equal(auth.authRedirect(pw, caps, '/admin/#/home'), null);
    assert.equal(auth.authRedirect(google, caps, '/admin/'), null);
    assert.equal(auth.authRedirect({ ...pw, user: null }, caps, '/admin/'), null);
    assert.equal(auth.authRedirect(null, caps, '/admin/'), null);
    assert.equal(auth.logoutRedirect(google, caps, { ok: true, next: '/elsewhere' }), null);
  }
  // an account login is account mode even when caps could not be read
  assert.equal(auth.accountMode(accountMe(), oldServer()), true);
  // a cloud server is account mode before /me knows the user (signed out, or /me failed)
  assert.equal(auth.authRedirect(null, cloud(), '/admin/#/displays'), `/login?next=${encodeURIComponent('/admin/#/displays')}`);
  // a single-tenant cloud-style server without an account login keeps its own login screen
  assert.equal(auth.authRedirect({ ...pw, user: null }, capsFrom({ ...cloudHealth(), tenancy: 'single' }), '/admin/'), null);
});

test('authRedirect(me, caps): the server login page, kept safe', () => {
  const caps = cloud();
  const next = encodeURIComponent('/admin/#pair=ABCD2345');
  assert.equal(auth.authRedirect(accountMe({ loginUrl: '/signin' }), caps, '/admin/#pair=ABCD2345'), `/signin?next=${next}`);
  assert.equal(auth.authRedirect(accountMe({ loginUrl: '/signin?lang=pt' }), caps, '/admin/#pair=ABCD2345'), `/signin?lang=pt&next=${next}`);
  assert.equal(auth.authRedirect(accountMe({ loginUrl: 'https://account.example.com/login' }), caps, '/admin/'), `https://account.example.com/login?next=${encodeURIComponent('/admin/')}`);
  // a login URL that is not http(s) or a local path falls back to /login
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', '/\t/evil.example', '', 42]) {
    assert.equal(auth.authRedirect(accountMe({ loginUrl: bad }), caps, '/admin/'), `/login?next=${encodeURIComponent('/admin/')}`, String(bad));
    assert.equal(auth.logoutRedirect(accountMe({ loginUrl: bad }), caps, {}), '/login', String(bad));
  }
  // `next` only ever points into the admin
  for (const p of ['/', '/account', '/admin', 'admin/', '/admin/\\x', '/admin/\u0000']) assert.equal(auth.safeNext(p), '/admin/', JSON.stringify(p));
  assert.equal(auth.safeNext('/admin/#/security'), '/admin/#/security');
  // logout: the server's next, else the login page, also when the logout call failed
  assert.equal(auth.logoutRedirect(accountMe(), caps, { ok: true, next: '/login?bye=1' }), '/login?bye=1');
  assert.equal(auth.logoutRedirect(accountMe({ loginUrl: '/signin' }), caps, null), '/signin');
  assert.equal(auth.logoutRedirect(accountMe(), caps, { next: 'https://evil.example/' }), '/login');
});

test('account menu links and household names', () => {
  assert.deepEqual(auth.accountLinks(accountMe()), { account: '/account', sessions: '/account/sessions', remove: '/account/delete' });
  assert.deepEqual(auth.accountLinks(accountMe({ deleteUrl: 'javascript:void(0)', sessionsUrl: 'https://account.example.com/sessions' })), {
    account: '/account',
    sessions: 'https://account.example.com/sessions',
    remove: null,
  });
  // only account logins get the menu
  assert.equal(auth.accountLinks({ ...accountMe(), user: { email: '', name: '', method: 'password' } }), null);
  assert.equal(auth.accountLinks({ user: { email: '', name: '', method: 'account' }, googleConfigured: false, passwordLoginEnabled: false }), null);
  assert.equal(auth.accountLinks(null), null);
  assert.equal(auth.cleanHouseholdName('  Casa\u0007 de la playa \n'), 'Casa de la playa');
  assert.equal(auth.cleanHouseholdName('x'.repeat(80)).length, auth.HOUSEHOLD_NAME_MAX);
  assert.equal(auth.cleanHouseholdName('   '), '');
});

test('accountNav: multi-tenant servers turn Security into Account', () => {
  const cl = nav.accountNav(nav.filterNav(nav.NAV_ITEMS, cloud()), cloud());
  const sec = cl.find((n) => n.id === 'security');
  assert.equal(sec.label, 'Cuenta');
  assert.equal(sec.icon, 'user');
  assert.equal(cl.filter((n) => n.label === 'Seguridad').length, 0);
  for (const caps of [selfHosted(), oldServer()]) {
    const sh = nav.accountNav(nav.filterNav(nav.NAV_ITEMS, caps), caps);
    assert.equal(sh.find((n) => n.id === 'security').label, 'Seguridad');
  }
  // the account entries in the settings search follow accountMenu
  const visible = cl.map((n) => n.id);
  const labels = (caps) => nav.filterSettings(search.SETTINGS_INDEX, caps, visible).filter((s) => s.route === 'security').map((s) => s.label);
  assert.deepEqual(labels(cloud()), ['Cambiar contraseña', 'Verificación en dos pasos', 'Nombre del hogar', 'Sesiones abiertas', 'Idioma de la cuenta', 'Entrar con Google', 'Descargar mis datos', 'Eliminar cuenta']);
  assert.deepEqual(labels(capsFrom({ ...cloudHealth(), features: { ...cloudHealth().features, accountSettings: false } })), ['Nombre del hogar']);
  assert.ok(!labels(selfHosted()).includes('Nombre del hogar'));
});

test('screenUrl: private links, display origin and open mode', () => {
  const origin = 'http://marco.local:3000';
  assert.equal(urls.screenUrl({ slug: 'kitchen', origin }), '/?screen=kitchen');
  assert.equal(urls.screenUrl({ slug: 'kitchen', origin, preview: true }), '/?screen=kitchen&preview=1');
  assert.equal(urls.screenUrl({ slug: null, origin }), null);
  assert.equal(urls.screenUrl({ slug: 'kitchen', linkKey: 'k-1', origin }), `${origin}/d/k-1`);
  assert.equal(urls.screenUrl({ slug: 'kitchen', linkKey: 'k-1', origin, displayOrigin: 'https://tv.example.com/', preview: true }), 'https://tv.example.com/d/k-1?preview=1');
});

test('liveNote: sent messages mention the delay only when the server polls', () => {
  setCaps(capsFrom({ ok: true, version: '0.5.0' }));
  assert.equal(liveNote.pollNote(), '');
  assert.equal(liveNote.withPollNote('Recargando · 2 pantallas'), 'Recargando · 2 pantallas');
  setCaps(capsFrom({ ok: true, version: '0.5.0', live: 'poll' }));
  assert.equal(liveNote.withPollNote('Recargando · 2 pantallas'), 'Recargando · 2 pantallas · llegará a las pantallas en unos 90 s');
  setCaps(capsFrom(cloudHealth()));
  assert.ok(liveNote.pollNote());
  assert.equal(dict.EN['llegará a las pantallas en unos 90 s'], 'reaches the screens within about 90 s');
  assert.ok(dict.PT['llegará a las pantallas en unos 90 s']);
  setCaps(capsFrom(null));
});

test('adminContract.json is up to date', () => {
  assert.equal(readFileSync(CONTRACT_PATH, 'utf8'), contractText(), 'run `npm run contract`');
});

test('adminContract.json: shape, features and account endpoints', () => {
  const c = generateContract();
  const seen = new Set();
  for (const e of c.endpoints) {
    const id = `${e.method} ${e.path}`;
    assert.ok(!seen.has(id), `duplicate ${id}`);
    seen.add(id);
    assert.match(e.method, /^(GET|POST|PUT|PATCH|DELETE)$/);
    assert.match(e.path, /^\/api\//);
    assert.ok(e.feature === null || FEATURE_KEYS.includes(e.feature), `${id}: unknown feature ${e.feature}`);
    assert.ok(Array.isArray(e.callers) && e.callers.length, id);
  }
  const get = (id) => c.endpoints.find((e) => `${e.method} ${e.path}` === id);
  assert.equal(get('GET /api/admin/config').request, null);
  assert.equal(get('PUT /api/admin/config').request, 'SaveConfigRequest');
  assert.deepEqual(get('GET /api/admin/countdowns').query, ['screen']);
  assert.equal(get('GET /api/admin/countdowns').feature, null);
  assert.ok(get('GET /api/admin/config').responseKeys.includes('screens'));
  assert.ok(get('GET /api/health').responseKeys.includes('features?'));
  assert.equal(get('GET /api/admin/photos').feature, 'gallery');
  for (const id of ['POST /api/admin/test/immich', 'GET /api/admin/immich/key', 'PUT /api/admin/immich/key', 'GET /api/admin/immich/albums', 'GET /api/admin/immich/status', 'POST /api/admin/immich/refresh', 'DELETE /api/admin/immich/cache']) {
    assert.equal(get(id)?.feature, 'immich', id);
  }
  assert.equal(get('GET /api/admin/immich/albums').responseArray, true);
  assert.equal(get('GET /api/admin/photos').responseArray, true);
  assert.equal(get('PUT /api/admin/password').feature, 'passwordLogin');
  assert.equal(get('POST /api/admin/pair/claim').feature, null);
  assert.equal(get('POST /api/account/lang').feature, 'accountMenu');
  assert.equal(get('PATCH /api/admin/household').feature, 'accountMenu');
  assert.deepEqual(get('GET /api/admin/google/calendars').query, ['account']);
  assert.ok(get('GET /api/admin/activity').query.includes('before'));
  assert.ok(get('GET /api/auth/me').responseKeys.includes('account?'));
});

test('dashboard greeting: first name, none for an email address', () => {
  assert.equal(util.greetingName('Ana María López'), 'Ana');
  assert.equal(util.greetingName('  Admin '), 'Admin');
  assert.equal(util.greetingName('ana@example.com'), '');
  assert.equal(util.greetingName(''), '');
  assert.equal(util.greetingName(undefined), '');
});

test('guessKind: vacation rentals only on clear words', () => {
  assert.equal(util.guessKind('Festivos en Portugal'), 'holidays');
  assert.equal(util.guessKind('Familia'), 'generic');
  assert.equal(util.guessKind('Calendario personal'), 'generic');
  assert.equal(util.guessKind('AL CUSTOM'), 'generic');
  assert.equal(util.guessKind('Reservas Airbnb'), 'airbnb');
  assert.equal(util.guessKind('Booking.com'), 'airbnb');
  assert.equal(util.guessKind('Cumpleaños'), 'birthdays');
});
