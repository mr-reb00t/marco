// "Salir del kiosko" and "Apagar" (routes/power.js): how the server asks the kiosk browser to close and the computer to
// power off. The server runs as an unprivileged user with NoNewPrivileges (deploy/marco.service), so it never starts a
// program: it writes a file in its runtime folder (/run/marco, systemd's RuntimeDirectory, emptied at every boot, so a
// request never outlives a reboot) and the other side acts on it. Neither side reads anything it would run.
// - kiosk-exit: a number (Date.now()). deploy/kiosk.sh, as the desktop user, closes Chromium when it changes and does
//   not open it again until the next login.
// - poweroff: only that it exists. marco-power.path (root, written by the installer, only after `sudo marco power on`)
//   starts marco-power.service, which deletes it and runs `systemctl --no-block poweroff`. The installer is the only
//   one that writes those units; without them the file does nothing.
// Who may ask: only the kiosk browser that deploy/kiosk.sh opened on this computer. It reads the kiosk key
// (kioskToken in data/secrets.json, made by store.js, never exported) from the data folder like it reads the screen's
// private link, and hands it to the page in the URL fragment (#kp=). The display sends it back in X-Marco-Kiosk. A
// copy of the display link, a proxy or a port forward on this machine does not carry it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const KIOSK_EXIT_FILE = 'kiosk-exit';
export const POWEROFF_FILE = 'poweroff';
/** The unit that `marco power on` writes (MARCO_POWER_UNIT overrides it, for tests). */
export const POWER_UNIT = '/etc/systemd/system/marco-power.path';

/**
 * The folder the requests go to: MARCO_RUN_DIR, else systemd's RUNTIME_DIRECTORY (deploy/marco.service
 * RuntimeDirectory=marco), and only an absolute path to a folder this process can write to. '' when there is none
 * (Docker, a server started by hand, no systemd): the cards say they are not available here.
 */
export function runDir(env = process.env) {
  const d = String(env.MARCO_RUN_DIR || env.RUNTIME_DIRECTORY || '').split(':')[0].trim();
  if (!d || !path.isAbsolute(d)) return '';
  try {
    if (!fs.statSync(d).isDirectory()) return '';
    fs.accessSync(d, fs.constants.W_OK);
    return d;
  } catch {
    return '';
  }
}

/**
 * `sudo marco power on` was run on this computer: its path unit exists and is enabled (the multi-user.target.wants
 * link next to it; /etc is readable under ProtectSystem=full). A unit that is installed but stopped is caught by
 * poweroffStale.
 */
export function powerUnitPresent(env = process.env) {
  const unit = env.MARCO_POWER_UNIT || POWER_UNIT;
  try {
    return fs.existsSync(unit) && fs.existsSync(path.join(path.dirname(unit), 'multi-user.target.wants', path.basename(unit)));
  } catch {
    return false;
  }
}

/** How long a power-off request may wait for marco-power.path before the server takes it for not running. */
export const POWEROFF_STALE_MS = 10_000;

/**
 * <dir>/poweroff is still there POWEROFF_STALE_MS after it was made: nothing took it (the path unit is stopped). The
 * file is removed, so a later `sudo marco power on` does not power the computer off at once.
 */
export function poweroffStale(dir, now = Date.now()) {
  const file = path.join(dir, POWEROFF_FILE);
  try {
    if (now - fs.statSync(file).mtimeMs <= POWEROFF_STALE_MS) return false;
  } catch {
    return false;
  }
  try {
    fs.rmSync(file, { force: true });
  } catch { /* the next check tries again */ }
  return true;
}

/** The kiosk key: 32 random bytes, base64url. */
export const KIOSK_KEY_RE = /^[A-Za-z0-9_-]{43}$/;
export const newKioskKey = () => crypto.randomBytes(32).toString('base64url');

/** The X-Marco-Kiosk header `sent` is the kiosk key `want` (compared in constant time). */
export function kioskKeyMatches(sent, want) {
  if (typeof sent !== 'string' || typeof want !== 'string' || !KIOSK_KEY_RE.test(want)) return false;
  const h = (v) => crypto.createHash('sha256').update(v).digest();
  return crypto.timingSafeEqual(h(sent), h(want)) && sent === want;
}

/** Ask the kiosk to close: a new number in <dir>/kiosk-exit, written next to it and renamed over it (0644: the desktop user reads it). */
export function requestKioskExit(dir, now = Date.now()) {
  const file = path.join(dir, KIOSK_EXIT_FILE);
  const tmp = path.join(dir, `.${KIOSK_EXIT_FILE}.tmp`);
  fs.rmSync(tmp, { force: true });
  fs.writeFileSync(tmp, String(Math.max(1, Math.floor(Number(now) || Date.now()))), { flag: 'wx', mode: 0o644 });
  fs.chmodSync(tmp, 0o644);
  fs.renameSync(tmp, file);
  return { already: false };
}

/** Ask for a power-off: <dir>/poweroff, created only when it is not there yet (`already` when it was). */
export function requestPoweroff(dir) {
  try {
    fs.writeFileSync(path.join(dir, POWEROFF_FILE), '', { flag: 'wx', mode: 0o644 });
    return { already: false };
  } catch (err) {
    if (err?.code === 'EEXIST') return { already: true };
    throw err;
  }
}

/** One request accepted per action every this many ms (a later one within it answers `already`; a power-off that
 * nothing took is caught by poweroffStale first). */
export const POWER_ACCEPT_MS = 30_000;
/** At most this many requests per action a minute; more get 429. */
export const POWER_PER_MINUTE = 6;

/**
 * The limits of the power requests, per action ('exit' | 'off'), in memory. try(action, now) → { ok } |
 * { retryAfter } (seconds, too many); accepted(action, now) notes an accepted one; already(action, now) says one was
 * accepted within POWER_ACCEPT_MS. One limit for the whole server, not per client: only the kiosk on this computer
 * gets this far.
 */
export function powerLimiter() {
  const tries = new Map();
  const done = new Map();
  return {
    try(action, now) {
      const list = (tries.get(action) ?? []).filter((t) => now - t < 60_000);
      if (list.length >= POWER_PER_MINUTE) {
        tries.set(action, list);
        return { retryAfter: Math.max(1, Math.ceil((list[0] + 60_000 - now) / 1000)) };
      }
      list.push(now);
      tries.set(action, list);
      return { ok: true };
    },
    accepted(action, now) {
      done.set(action, now);
    },
    forget(action) {
      done.delete(action);
    },
    already(action, now) {
      const t = done.get(action);
      if (t === undefined) return false;
      return now - t < POWER_ACCEPT_MS;
    },
  };
}
