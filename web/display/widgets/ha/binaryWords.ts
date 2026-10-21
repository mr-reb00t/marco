// What a binary sensor says on the screen, by its device class, as Home Assistant says it: a door "Abierta" or
// "Cerrada", a plug "Enchufado" or "Desenchufado", a lock "Sin llave" when it is on. Keys of web/shared/i18n.ts; no
// imports, so the tests read the table as it is (i18n-complete.test.js).

/** Every device class Home Assistant gives a binary sensor: [on, off] keys. A lock is on when it is unlocked. */
export const BINARY_KEY: Record<string, [string, string]> = {
  battery: ['haBinLow', 'haBinNormal'],
  battery_charging: ['haBinCharging', 'haBinNotCharging'],
  carbon_monoxide: ['haDetected', 'haBinClear'],
  cold: ['haBinCold', 'haBinNormal'],
  connectivity: ['haBinConnected', 'haBinDisconnected'],
  door: ['haOpen', 'haClosed'],
  garage_door: ['haOpen', 'haClosed'],
  gas: ['haDetected', 'haBinClear'],
  heat: ['haBinHot', 'haBinNormal'],
  light: ['haBinLight', 'haBinNoLight'],
  lock: ['haUnlocked', 'haLocked'],
  moisture: ['haBinWet', 'haBinDry'],
  motion: ['haDetected', 'haBinClear'],
  moving: ['haBinMoving', 'haBinNotMoving'],
  occupancy: ['haDetected', 'haBinClear'],
  opening: ['haOpen', 'haClosed'],
  plug: ['haBinPlugged', 'haBinUnplugged'],
  power: ['haOn', 'haOff'],
  presence: ['haHome', 'haAway'],
  problem: ['haBinProblem', 'haBinOk'],
  running: ['haBinRunning', 'haBinNotRunning'],
  safety: ['haBinUnsafe', 'haBinSafe'],
  smoke: ['haDetected', 'haBinClear'],
  sound: ['haDetected', 'haBinClear'],
  tamper: ['haBinTamper', 'haBinClear'],
  update: ['haBinUpdate', 'haUpToDate'],
  vibration: ['haDetected', 'haBinClear'],
  window: ['haOpen', 'haClosed'],
};

/** The key of a binary sensor's state (a class Home Assistant does not have, or none: Encendido / Apagado). */
export function binaryKey(on: boolean, dc: string): string {
  const k = Object.hasOwn(BINARY_KEY, dc) ? BINARY_KEY[dc] : ['haOn', 'haOff'];
  return on ? k[0] : k[1];
}
