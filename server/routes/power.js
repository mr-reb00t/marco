// "Salir del kiosko" and "Apagar" (Personalizado navigation cards, feature kioskPower): a screen on the computer that
// runs Marco closes its kiosk browser or powers that computer off. How the request reaches the kiosk script and the
// power-off unit: server/power.js. Mounted with the display routers (app.js), so displayAuth and the Host guard apply.
//
// A screen has no admin session, so who may ask is decided by where the request comes from and what the screen shows:
//   - this computer, straight (lib/net.js sameMachineDirect: a loopback socket, no proxy header, Host localhost,
//     127.0.0.1 or [::1]); a POST also from a page of that same origin (sameOrigin), never a sandboxed web widget or
//     another site in the same browser;
//   - a display the server trusts, on a screen with "Permitir tocar en la pantalla" on and not private, that shows that
//     very card now (not hidden, its schedule and its condition on);
//   - a few requests a minute per action; a second request soon after an accepted one changes nothing.
// Unknown, not shown, private or no touch: 404. Refused requests leave no activity entry; accepted ones do.
import { Router } from 'express';
import { getConfig } from '../store.js';
import { requestScreen } from '../displayAccess.js';
import { screenPrivacy } from '../privacy.js';
import { trustedDisplay } from '../family.js';
import { hiddenItems } from '../canvasConditions.js';
import { CANVAS_ID_RE, POWER_KINDS, powerCardOf } from '../core/canvasCore.js';
import { sameMachineDirect, sameOrigin } from '../lib/net.js';
import { logActivity } from '../activity.js';
import { powerLimiter, powerUnitPresent, requestKioskExit, requestPoweroff, runDir } from '../power.js';
import { jsonOnly } from './family.js';

const ACTIONS = Object.keys(POWER_KINDS);
const ACTIVITY = { exit: 'display.kiosk_exit', off: 'display.poweroff' };

/**
 * `deps` (tests): requestKioskExit(dir, now), requestPoweroff(dir), unitPresent(), runDir(), now(), delayMs (the wait
 * between the answer and the request, so the answer and the log entry go out first).
 */
export function powerRouter(deps = {}) {
  const d = { requestKioskExit, requestPoweroff, unitPresent: () => powerUnitPresent(), runDir: () => runDir(), now: () => Date.now(), delayMs: 300, ...deps };
  const limits = powerLimiter();
  const r = Router();

  /** The card `item` of `action` on the requesting screen, while the screen may use it; null otherwise. */
  const cardOf = (req, item, action) => {
    if (!trustedDisplay(req) || typeof item !== 'string' || !CANVAS_ID_RE.test(item)) return null;
    const cfg = getConfig();
    const { screen, empty } = requestScreen(cfg, req);
    if (!screen || empty || screen.layout?.preset !== 'canvas' || !screen.canvas?.touch) return null;
    if (screenPrivacy(cfg, screen).active) return null;
    const tz = cfg.datetime?.timezone || 'UTC';
    const kinds = action ? [action] : ACTIONS;
    for (const a of kinds) {
      const it = powerCardOf(screen, item, POWER_KINDS[a], { tz });
      if (it && !hiddenItems(cfg, screen).has(item)) return { screen, action: a };
    }
    return null;
  };

  /** Whether this install can do `action` now ('' = yes). */
  const unavailable = (action) => {
    if (!d.runDir()) return 'no_runtime';
    if (action === 'off' && !d.unitPresent()) return 'not_enabled';
    return '';
  };

  // GET /api/display/power?item=<card id>: { action, ready, reason? } for that card (the display draws it from this).
  r.get('/display/power', (req, res) => {
    res.set('cache-control', 'no-store');
    if (!sameMachineDirect(req)) return res.status(403).json({ error: 'not_local' });
    const found = cardOf(req, req.query.item);
    if (!found) return res.status(404).json({ error: 'not_found' });
    const why = unavailable(found.action);
    res.json({ action: found.action, ready: !why, ...(why ? { reason: why } : {}) });
  });

  // POST /api/display/power { item, action: 'exit' | 'off' } → 202 { ok, already? } (docs/API.md "Kiosk and power").
  r.post('/display/power', jsonOnly, (req, res) => {
    res.set('cache-control', 'no-store');
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const action = typeof b.action === 'string' && ACTIONS.includes(b.action) ? b.action : '';
    if (!action || typeof b.item !== 'string') return res.status(400).json({ error: 'invalid' });
    if (!sameMachineDirect(req) || !sameOrigin(req)) return res.status(403).json({ error: 'not_local' });
    const found = cardOf(req, b.item, action);
    if (!found) return res.status(404).json({ error: 'not_found' });
    const now = d.now();
    const tried = limits.try(action, now);
    if (!tried.ok) {
      res.set('retry-after', String(tried.retryAfter));
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (limits.already(action, now)) return res.status(202).json({ ok: true, already: true });
    const why = unavailable(action);
    if (why) return res.status(409).json({ error: why });
    const dir = d.runDir();
    limits.accepted(action, now);
    const { screen } = found;
    logActivity(ACTIVITY[action], { req, actor: `display:${screen.slug || ''}`, level: 'warn', data: { screen: screen.slug, item: b.item } });
    res.status(202).json({ ok: true });
    setTimeout(() => {
      try {
        if (action === 'exit') d.requestKioskExit(dir, now);
        else d.requestPoweroff(dir);
      } catch (err) {
        limits.forget(action);
        console.error(`[power] could not ask for ${action === 'exit' ? 'the kiosk to close' : 'a power-off'} in ${dir}: ${err.message}`);
      }
    }, d.delayMs).unref?.();
  });

  return r;
}
