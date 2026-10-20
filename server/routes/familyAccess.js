// Family access (#16; server/familyAccess.js, server/core/familyAccessCore.js). Every answer: cache-control private,
// no-store. POST bodies must be JSON (415 otherwise) and the CSRF guard checks the origin, so a page on another site
// cannot send anything here; the phone's token travels in a header, never in a cookie.
//   familyAccessAdminRouter() mounted at /api/admin (session required):
//     GET    /family-access                        → FamilyAccessListResponse
//     POST   /family-access          { name, memberId?, perms? } → { person, link: { path } }  (the link, this once)
//     PATCH  /family-access/:id      { name?, memberId?, perms? } → { person }
//     POST   /family-access/:id/link               → { person, link: { path } }  (a new link; the old one stops working)
//     POST   /family-access/:id/code { screenId }  → { code, expiresAt, screenId, delivered }  (on that screen, 2 minutes)
//     DELETE /family-access/:id/devices/:deviceId  → { ok }
//     DELETE /family-access/:id                    → { ok }  (the link, every phone and any code go with the person)
//   familyAccessMemberRouter() mounted at /api (the phone dashboard /my):
//     POST   /member/redeem   { link, token? } → { token, state }  (the private link opened on a phone)
//     POST   /member/pair     { code }         → { token, state }  (a code shown on a screen, single use)
//   with the header X-Member-Token (the token those return):
//     GET    /member/state                     → MemberState
//     POST   /member/message  { text, screens?, durationSec? } → { ok, delivered }
//     POST   /member/privacy  { mode: on | off }               → { ok, privacy }
//     POST   /member/night    { mode: on | off | auto }        → { ok, delivered }
//     POST   /member/todo     { text }                         → { ok, id }
//     POST   /member/event    { title, date, allDay, startTime?, endTime? } → { ok, id }
//     POST   /member/forget                    → { ok }  (this phone signs out)
// Nothing under /api/member reads or changes anything an admin session protects: the token is only checked here.
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { lanAddresses } from '../setup.js';
import { publicOrigin } from '../lib/net.js';
import { jsonOnly } from './family.js';
import { MAX_PEOPLE } from '../core/familyAccessCore.js';
import {
  listPeople, createPerson, updatePerson, regenerateLink, deletePerson, revokePersonDevice, showCode,
  redeemLink, redeemCode, memberAuth, stateOf, forgetDevice, memberMessage, memberPrivacy, memberNight, memberTodo, memberEvent,
} from '../familyAccess.js';

const noStore = (req, res, next) => { res.set('cache-control', 'private, no-store'); next(); };
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

/** An { error, status, code? } result as the answer. */
function send(res, out) {
  if (out.status === 429) res.set('retry-after', '60');
  return res.status(out.status || 400).json({ error: out.error, code: out.code || out.error });
}

export function familyAccessAdminRouter() {
  const r = Router();
  r.use('/family-access', requireAuth, noStore, jsonOnly);

  r.get('/family-access', (req, res) => res.json({ people: listPeople(), max: MAX_PEOPLE, lanAddresses: lanAddresses(), publicUrl: publicOrigin() }));

  r.post('/family-access', (req, res) => {
    const out = createPerson(body(req), { req });
    if (out.error) return send(res, out);
    res.json(out);
  });

  r.patch('/family-access/:id', (req, res) => {
    const out = updatePerson(String(req.params.id), body(req), { req });
    if (out.error) return send(res, out);
    res.json(out);
  });

  r.post('/family-access/:id/link', (req, res) => {
    const out = regenerateLink(String(req.params.id), { req });
    if (out.error) return send(res, out);
    res.json(out);
  });

  r.post('/family-access/:id/code', (req, res) => {
    const screenId = typeof body(req).screenId === 'string' ? body(req).screenId : '';
    const out = showCode(String(req.params.id), screenId, { req });
    if (out.error) return send(res, out);
    res.json(out);
  });

  r.delete('/family-access/:id/devices/:deviceId', (req, res) => {
    if (!revokePersonDevice(String(req.params.id), String(req.params.deviceId), { req })) return res.status(404).json({ error: 'not_found', code: 'not_found' });
    res.json({ ok: true });
  });

  r.delete('/family-access/:id', (req, res) => {
    if (!deletePerson(String(req.params.id), { req })) return res.status(404).json({ error: 'not_found', code: 'not_found' });
    res.json({ ok: true });
  });
  return r;
}

export function familyAccessMemberRouter() {
  const r = Router();
  r.use('/member', noStore, jsonOnly);

  r.post('/member/redeem', (req, res) => {
    const b = body(req);
    const out = redeemLink(b.link, b.token, req);
    if (out.error) return send(res, out);
    res.json(out);
  });

  r.post('/member/pair', (req, res) => {
    const out = redeemCode(body(req).code, req);
    if (out.error) return send(res, out);
    res.json(out);
  });

  r.use('/member', memberAuth);

  r.get('/member/state', (req, res) => res.json(stateOf(req.member.person)));

  const action = (fn) => (req, res) => {
    const out = fn(req.member, body(req), { req });
    if (out.error) return send(res, out);
    res.json(out);
  };
  r.post('/member/message', action(memberMessage));
  r.post('/member/privacy', action(memberPrivacy));
  r.post('/member/night', action(memberNight));
  r.post('/member/todo', action(memberTodo));
  r.post('/member/event', action(memberEvent));
  r.post('/member/forget', (req, res) => {
    forgetDevice(req.member, { req });
    res.json({ ok: true });
  });
  r.use('/member', (req, res) => res.status(404).json({ error: 'not found' }));
  return r;
}
