// Which animation a carousel switch uses and for how long (pure, no DOM: the tests load it with Node). The DOM side
// is web/display/screenSwitch.ts.
//
// - 'random' picks from CAROUSEL_RANDOM_POOL by the switch number (the count of step starts since the epoch, see
//   switchNumber) and the carousel id, so every TV on the same carousel picks the same one, and two switches in a
//   row never use the same one.
// - Reduced motion (the system setting), ?lite=1 and browsers with very little memory get a short fade instead. A
//   Raspberry Pi runs the chosen animation like any other screen.
// - 'dissolve' needs the WebGL layer; without it the switch is a fade.
// - A swipe (SwitchInfo.dir) always slides its way, fast, whatever the carousel's own animation.
import type { CarouselSpeed, CarouselStep, CarouselTransition } from '../shared/types';
import { CAROUSEL_RANDOM_POOL, CAROUSEL_SPEEDS, CAROUSEL_TRANSITIONS, carouselSlot, speedOf } from '../shared/carousels';

export type SwitchEffect = Exclude<CarouselTransition, 'random'>;

/** What the controller knows about a switch: the carousel's settings and which switch this is. */
export interface SwitchInfo {
  transition: CarouselTransition;
  speed: CarouselSpeed;
  /** switchNumber() at the moment of the switch */
  n: number;
  /** the carousel id: two carousels do not share a random sequence */
  seed: string;
  /** a swipe brought this screen: 1 = the next one (comes in from the right), -1 = the previous one (from the left) */
  dir?: 1 | -1;
}

export interface SwitchEnv {
  /** prefers-reduced-motion */
  reduced: boolean;
  /** ?lite=1 or a low-power device */
  lowPower: boolean;
  /** the WebGL layer runs (for 'dissolve') */
  gl: boolean;
  /** ?tr=<name>: force one animation (filming, the admin's "Probar") */
  force?: string | null;
  /** ?trSpeed=fast|normal|slow */
  forceSpeed?: string | null;
}

export interface SwitchPlan {
  effect: SwitchEffect;
  ms: number;
  /** a plain fade of #app, with no copy of the page (reduced motion, lite mode, very little memory) */
  light?: boolean;
  /** 'slide' only: -1 moves to the right (a swipe back); absent = to the left, as every automatic slide */
  dir?: 1 | -1;
}

/** The fade used where motion is unwelcome or too heavy (reduced motion, lite mode, very little memory). */
export const SHORT_FADE_MS = 300;

/** Count of step starts since the Unix epoch at `nowMs` (the same on every TV with the same clock). */
export function switchNumber(steps: CarouselStep[], nowMs: number): number {
  const slot = carouselSlot(steps, nowMs);
  if (!slot) return Math.floor(nowMs / 1000);
  return Math.floor(slot.startsAt / slot.cycleMs) * steps.length + slot.index;
}

/** 32-bit FNV-1a of a string. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy of the pool for block `b` (raw: without the fix at the block start). */
function rawBlock(b: number, seed: string): SwitchEffect[] {
  const out = [...CAROUSEL_RANDOM_POOL] as SwitchEffect[];
  const r = rng(hash(`${seed}|${b}`));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The animation 'random' uses for switch `n`. The switches go in blocks of the pool's size; each block is a shuffle
 * of the pool, so every animation shows once per block, and the first of a block is swapped with the second when
 * it equals the last of the block before. Only the first two of a block move, so the last one never depends on
 * that fix and the answer needs no history.
 */
export function randomPick(n: number, seed = ''): SwitchEffect {
  const k = CAROUSEL_RANDOM_POOL.length;
  const i = Number.isFinite(n) ? Math.floor(n) : 0;
  const b = Math.floor(i / k);
  const pos = i - b * k;
  const cur = rawBlock(b, seed);
  if (k > 1 && pos < 2) {
    const prevLast = rawBlock(b - 1, seed)[k - 1];
    if (cur[0] === prevLast) [cur[0], cur[1]] = [cur[1], cur[0]];
  }
  return cur[pos];
}

/** The animation and duration of one switch. */
export function planSwitch(info: SwitchInfo, env: SwitchEnv): SwitchPlan {
  if (info.dir === 1 || info.dir === -1) {
    // a swipe is a direct manipulation: its direction must show whatever the carousel's own animation is ('none'
    // and 'random' included), and ?tr= is left out since it is for filming the automatic rotation. Where motion is
    // unwelcome or too heavy it is the same short fade as any other switch.
    if (env.reduced || env.lowPower) return { effect: 'fade', ms: SHORT_FADE_MS, light: true };
    return { effect: 'slide', ms: CAROUSEL_SPEEDS.fast, dir: info.dir };
  }
  const forced = env.force && (CAROUSEL_TRANSITIONS as readonly string[]).includes(env.force) ? (env.force as CarouselTransition) : null;
  const name: CarouselTransition = forced ?? ((CAROUSEL_TRANSITIONS as readonly string[]).includes(info.transition) ? info.transition : 'fade');
  if (name === 'none') return { effect: 'none', ms: 0 };
  const ms = CAROUSEL_SPEEDS[speedOf(env.forceSpeed || info.speed)];
  if (env.reduced || env.lowPower) return { effect: 'fade', ms: Math.min(ms, SHORT_FADE_MS), light: true };
  let effect: SwitchEffect = name === 'random' ? randomPick(info.n, info.seed) : name;
  if (effect === 'dissolve' && !env.gl) effect = 'fade';
  return { effect, ms };
}

/** A browser that says it has very little memory or a single core (`mem` and `cores` come from navigator). */
export function isLowPower(mem?: number, cores?: number): boolean {
  if (typeof mem === 'number' && mem > 0 && mem < 2) return true;
  return typeof cores === 'number' && cores > 0 && cores < 2;
}

/** Desktop Chromium on an ARM board (a Raspberry Pi and the like) by its user agent; Android is not one. */
export function isArmLinuxUA(ua: string): boolean {
  return /Linux (armv\d+l?|aarch64)/i.test(ua) && !/Android/i.test(ua);
}

/** The GPU of a Raspberry Pi (VideoCore / V3D) or of a similar small ARM board (Mali), from the WebGL renderer name. */
export function isLowPowerGPU(renderer: string | null | undefined): boolean {
  return !!renderer && /V3D|VideoCore|Mali/i.test(renderer);
}

/**
 * A WebGL renderer name that is the CPU drawing instead of a graphics chip: Chrome's SwiftShader, Mesa's llvmpipe and
 * softpipe, Windows' Microsoft Basic Render Driver and WARP (what Chrome falls back to when the GPU driver crashed).
 */
export function isSoftwareGPU(renderer: string | null | undefined): boolean {
  return !!renderer && /SwiftShader|llvmpipe|softpipe|Basic Render|\bWARP\b|Software Rasterizer|Software Adapter/i.test(renderer);
}

/**
 * A WebGL renderer name that is a desktop graphics chip (ANGLE on Direct3D or Metal, Mesa drivers, the big vendors).
 * Chrome refuses a context with failIfMajorPerformanceCaveat on some of them although WebGL runs in hardware there.
 * The small boards (V3D, Mali) are not listed: the probe and the low-power checks decide for them.
 */
export function isHardwareGPU(renderer: string | null | undefined): boolean {
  if (!renderer || isSoftwareGPU(renderer)) return false;
  return /NVIDIA|GeForce|Quadro|Radeon|AMD|\bATI\b|Intel|Iris|UHD Graphics|HD Graphics|Apple M\d|Apple GPU|Direct3D1[01]|Metal|Mesa DRI|RADV|radeonsi|\bi915\b|nouveau/i.test(renderer);
}

/**
 * Desktop Linux on ARM (a Pi and the like) from the client hints (Chromium): `architecture` and `platform` of
 * userAgentData. Macs and Windows on ARM are fast enough, and Android is not desktop Linux.
 */
export function isArmDesktop(architecture: string | null | undefined, platform: string | null | undefined, mobile?: boolean): boolean {
  if (mobile || !/^Linux$/i.test(platform ?? '')) return false;
  return /^arm/i.test(architecture ?? '');
}
