// "Salir del kiosko" and "Apagar" (routes/power.js): how the server asks the kiosk browser to close and the computer to
// power off. The server runs as an unprivileged user with NoNewPrivileges (deploy/marco.service), so it never starts a
// program: it writes a file in its runtime folder (/run/marco, systemd's RuntimeDirectory, emptied at every boot, so a
// request never outlives a reboot) and the other side acts on it. Neither side reads anything it would run.
// - kiosk-exit: a number (Date.now()). deploy/kiosk.sh, as the desktop user, closes Chromium when it changes and does
//   not open it again until the next login.
// - poweroff: only that it exists. marco-power.path (root, written by the installer, only after `sudo marco power on`)
//   starts marco-power.service, which deletes it and runs `systemctl --no-block poweroff`. The installer is the only
//   one that writes those units; without them the file does nothing.
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

/** `sudo marco power on` was run on this computer (its path unit exists; /etc is readable under ProtectSystem=full). */
export function powerUnitPresent(env = process.env) {
  try {
    return fs.existsSync(env.MARCO_POWER_UNIT || POWER_UNIT);
  } catch {
    return false;
  }
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

/** One request accepted per action every this many ms (a later one within it answers `already`). */
export const POWER_ACCEPT_MS = 30_000;
/** At most this many requests per action a minute; more get 429. */
export const POWER_PER_MINUTE = 6;

/**
 * The limits of the power requests, per action ('exit' | 'off'), in memory. try(action, now) → { ok } |
 * { retryAfter } (seconds, too many); accepted(action, now) notes an accepted one; already(action, now) says one was
 * accepted within POWER_ACCEPT_MS (for 'off', ever: the computer is going down).
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
      return action === 'off' || now - t < POWER_ACCEPT_MS;
    },
  };
}
