// "Salir del kiosko" and "Apagar" on the screen (widgets/canvas/nav.ts draws them; the server side is
// server/routes/power.js). Pure: no DOM and no fetches, so the tests run it with a fake clock
// (server/test/kiosk-power.test.js).
//
// - A card on a browser that did not open Marco at localhost (another device, or the Pi showing the server by its
//   network address), or that has no kiosk key (identity.ts kioskKey: only the browser deploy/kiosk.sh opens gets
//   one), never asks the server: it says it only works on the Pi that runs Marco.
// - The first tap arms the card for CONFIRM_MS; only a second tap within that time sends the request, so a brush of
//   the hand never closes the kiosk or powers the Pi off.

export type PowerAction = 'exit' | 'off';

/** What the card shows. */
export type PowerUi =
  | 'remote' // not the kiosk at localhost: only on the Pi that runs Marco
  | 'checking' // the first answer of GET /api/display/power is on its way
  | 'unavailable' // this install cannot do it (no runtime folder: Docker, no systemd), or the server says no
  | 'disabled' // Apagar before `sudo marco power on`
  | 'idle' // ready
  | 'confirm' // first tap: a second one within CONFIRM_MS goes ahead
  | 'working' // asked: the kiosk closes or the Pi goes down
  | 'error'; // too many taps, or no answer: back to idle after ERROR_MS

/** How long the first tap keeps the card armed. */
export const CONFIRM_MS = 4000;
/** How long an error stays on the card. */
export const ERROR_MS = 4000;
/** How often the card asks again whether it can work (a `sudo marco power on` meanwhile). */
export const POWER_RECHECK_MS = 5 * 60_000;

/** The host names that make a page "on this computer" (as the server's own check, lib/net.js sameMachineDirect). */
export function loopbackHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/** The card's state from GET /api/display/power: its answer, or the HTTP status of a refusal (0: no answer). */
export function uiOfStatus(r: { ready?: boolean; reason?: string } | number): PowerUi {
  if (typeof r === 'number') return r === 403 || r === 404 ? 'unavailable' : 'error';
  if (r.ready) return 'idle';
  return r.reason === 'not_enabled' ? 'disabled' : 'unavailable';
}

/** The card's state after POST /api/display/power answered with `status` (and `error`). */
export function uiOfAnswer(status: number, error = ''): PowerUi {
  if (status === 202) return 'working';
  if (status === 409 && error === 'not_enabled') return 'disabled';
  if (status === 409 || status === 403 || status === 404) return 'unavailable';
  return 'error';
}

/** A tap on the card in `state` at `now` (`armedAt`: when the first tap armed it): the next state, and whether to ask. */
export function planTap(state: PowerUi, now: number, armedAt: number): { state: PowerUi; send: boolean; armedAt: number } {
  if (state === 'idle') return { state: 'confirm', send: false, armedAt: now };
  if (state === 'confirm') {
    if (now - armedAt <= CONFIRM_MS) return { state: 'working', send: true, armedAt };
    // the first tap ran out: this one arms it again
    return { state: 'confirm', send: false, armedAt: now };
  }
  return { state, send: false, armedAt };
}

/** The state at `now` once its time is over: confirm and error go back to idle. */
export function settle(state: PowerUi, now: number, since: number): PowerUi {
  if (state === 'confirm' && now - since > CONFIRM_MS) return 'idle';
  if (state === 'error' && now - since > ERROR_MS) return 'idle';
  return state;
}
