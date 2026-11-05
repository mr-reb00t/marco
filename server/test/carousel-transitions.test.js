// Carousel animations: validation of transition and transitionSpeed (old configs keep working), the 'random' pick
// (same on every TV, never the same twice in a row), the switch plan (reduced motion, lite / Raspberry Pi, no
// WebGL, ?tr= forcing) and the selector rewrite that styles the still copy of the screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { carouselBlock, CAROUSEL_RANDOM_POOL, CAROUSEL_SPEEDS, CAROUSEL_TRANSITIONS } from '../core/carousels.js';
import { loadWebModules } from './webModules.js';

const [plan, sw, admin] = await loadWebModules('/web/display/switchPlan.ts', '/web/display/screenSwitch.ts', '/web/admin/sections/Carousels.tsx');
const { randomPick, planSwitch, switchNumber, isLowPower, isArmLinuxUA, isLowPowerGPU, isArmDesktop, isSoftwareGPU, isHardwareGPU, SHORT_FADE_MS } = plan;

function config(carousels) {
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.screens.push(defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' }));
  c.carousels = { items: carousels };
  return c;
}
const steps = [{ screenId: 's_main', seconds: 30 }, { screenId: 's_kitchen', seconds: 30 }];

test('validation: every transition and speed is kept, unknown ones are errors, old configs get fade / normal', () => {
  for (const tr of CAROUSEL_TRANSITIONS) {
    for (const speed of Object.keys(CAROUSEL_SPEEDS)) {
      const r = validateConfig(config([{ name: 'L', steps, transition: tr, transitionSpeed: speed }]));
      assert.deepEqual(r.errors, []);
      assert.equal(r.value.carousels.items[0].transition, tr);
      assert.equal(r.value.carousels.items[0].transitionSpeed, speed);
    }
  }
  const old = validateConfig(config([{ name: 'Old', steps, transition: 'fade' }]));
  assert.deepEqual(old.errors, []);
  assert.equal(old.value.carousels.items[0].transitionSpeed, 'normal');
  const none = validateConfig(config([{ name: 'Bare', steps }]));
  assert.equal(none.value.carousels.items[0].transition, 'fade');
  const bad = validateConfig(config([{ name: 'Bad', steps, transition: 'spin', transitionSpeed: 'warp' }]));
  assert.deepEqual(bad.errors.map((e) => e.path).sort(), ['carousels.items[0].transition', 'carousels.items[0].transitionSpeed']);
  const num = validateConfig(config([{ name: 'Num', steps, transitionSpeed: 800 }]));
  assert.deepEqual(num.errors.map((e) => e.path), ['carousels.items[0].transitionSpeed']);
});

test('carouselBlock: the display gets the speed, with a default for carousels saved before speeds', () => {
  const cfg = config([]);
  assert.equal(carouselBlock(cfg, { id: 'v_a', slug: 'a', name: 'A', transition: 'wipe', transitionSpeed: 'slow', steps }).transitionSpeed, 'slow');
  const b = carouselBlock(cfg, { id: 'v_a', slug: 'a', name: 'A', transition: 'fade', steps });
  assert.equal(b.transitionSpeed, 'normal');
  assert.equal(carouselBlock(cfg, { id: 'v_a', slug: 'a', name: 'A', transition: 'spin', steps }).transition, 'fade');
});

test('random: deterministic, never the same twice in a row, every animation shows', () => {
  const seq = Array.from({ length: 2000 }, (_, i) => randomPick(i - 1000, 'v_loop'));
  assert.deepEqual(seq, Array.from({ length: 2000 }, (_, i) => randomPick(i - 1000, 'v_loop')), 'same answer on every TV');
  for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], `switch ${i - 1000} repeats`);
  for (const e of CAROUSEL_RANDOM_POOL) assert.ok(seq.includes(e), e);
  // each window of pool-size switches is spread out: no animation more than twice
  const counts = {};
  for (const e of seq.slice(0, 10)) counts[e] = (counts[e] || 0) + 1;
  assert.ok(Object.values(counts).every((n) => n <= 3));
  const other = Array.from({ length: 50 }, (_, i) => randomPick(i, 'v_other'));
  assert.notDeepEqual(other, seq.slice(1000, 1050), 'another carousel has its own sequence');
  assert.ok(CAROUSEL_RANDOM_POOL.includes(randomPick(NaN)));
});

test('switchNumber: one more at every step start, the same within a step', () => {
  const t = Date.UTC(2026, 9, 11, 10, 0, 0);
  const n0 = switchNumber(steps, t);
  assert.equal(switchNumber(steps, t + 1000), n0);
  const slot = 30_000 - (t % 30_000);
  assert.equal(switchNumber(steps, t + slot), n0 + 1);
  assert.equal(switchNumber(steps, t + slot + 30_000), n0 + 2);
  assert.equal(switchNumber(steps, t + slot + 60_000), n0 + 3, 'continues across loops');
  assert.equal(typeof switchNumber([], t), 'number');
});

test('planSwitch: speeds, reduced motion and low power give a short fade, dissolve needs GL, ?tr= forces', () => {
  const env = { reduced: false, lowPower: false, gl: true };
  const info = (transition, speed = 'normal', n = 0) => ({ transition, speed, n, seed: 'v_a' });
  assert.deepEqual(planSwitch(info('slide', 'fast'), env), { effect: 'slide', ms: 400 });
  assert.deepEqual(planSwitch(info('zoom'), env), { effect: 'zoom', ms: 800 });
  assert.deepEqual(planSwitch(info('wipe', 'slow'), env), { effect: 'wipe', ms: 1400 });
  assert.deepEqual(planSwitch(info('wipe', 'bogus'), env), { effect: 'wipe', ms: 800 });
  assert.deepEqual(planSwitch(info('dissolve'), env), { effect: 'dissolve', ms: 800 });
  assert.deepEqual(planSwitch(info('dissolve'), { ...env, gl: false }), { effect: 'fade', ms: 800 });
  assert.deepEqual(planSwitch(info('none'), env), { effect: 'none', ms: 0 });
  assert.deepEqual(planSwitch(info('spin'), env), { effect: 'fade', ms: 800 });
  for (const tr of ['slide', 'zoom', 'wipe', 'dissolve', 'random']) {
    assert.deepEqual(planSwitch(info(tr, 'slow'), { ...env, reduced: true }), { effect: 'fade', ms: SHORT_FADE_MS, light: true });
    assert.deepEqual(planSwitch(info(tr, 'slow'), { ...env, lowPower: true }), { effect: 'fade', ms: SHORT_FADE_MS, light: true });
  }
  assert.equal(planSwitch(info('none'), { ...env, lowPower: true }).effect, 'none', 'off stays off');
  assert.equal(planSwitch(info('random', 'normal', 7), env).effect, randomPick(7, 'v_a'));
  assert.deepEqual(planSwitch(info('fade'), { ...env, force: 'wipe', forceSpeed: 'fast' }), { effect: 'wipe', ms: 400 });
  assert.deepEqual(planSwitch(info('slide'), { ...env, force: 'nonsense' }), { effect: 'slide', ms: 800 });
});

test('planSwitch with a swipe: a fast slide its way whatever the carousel uses; reduced and low power fade', () => {
  const env = { reduced: false, lowPower: false, gl: true };
  const info = (transition, dir, speed = 'slow') => ({ transition, speed, n: 3, seed: 'v_a', dir });
  assert.deepEqual(planSwitch(info('fade', -1), env), { effect: 'slide', ms: 400, dir: -1 });
  assert.deepEqual(planSwitch(info('fade', 1), env), { effect: 'slide', ms: 400, dir: 1 });
  // 'none' and 'random' too: the direction of a direct touch must show; ?tr= is for filming the automatic rotation
  assert.deepEqual(planSwitch(info('none', 1), env), { effect: 'slide', ms: 400, dir: 1 });
  assert.deepEqual(planSwitch(info('random', 1), env), { effect: 'slide', ms: 400, dir: 1 });
  assert.deepEqual(planSwitch(info('zoom', -1), { ...env, force: 'wipe' }), { effect: 'slide', ms: 400, dir: -1 });
  assert.deepEqual(planSwitch(info('slide', -1), { ...env, reduced: true }), { effect: 'fade', ms: SHORT_FADE_MS, light: true });
  assert.deepEqual(planSwitch(info('none', 1), { ...env, lowPower: true }), { effect: 'fade', ms: SHORT_FADE_MS, light: true });
  // automatic switches keep their plan (no dir)
  assert.deepEqual(planSwitch(info('slide', undefined, 'fast'), env), { effect: 'slide', ms: 400 });
});

test('the slide runs both ways: a swipe back moves the old screen right and brings the new one from the left', () => {
  const src = fs.readFileSync(new URL('../../web/display/screenSwitch.ts', import.meta.url), 'utf8');
  assert.match(src, /plan\.dir === -1 \? -1 : 1/);
  assert.match(src, /translate3d\(\$\{-100 \* s\}%,0,0\)/);
});

test('isLowPower: only very little memory or one core (a Raspberry Pi gets the real animation)', () => {
  assert.equal(isLowPower(), false);
  assert.equal(isLowPower(8, 8), false);
  assert.equal(isLowPower(4, 4), false, 'a Raspberry Pi');
  assert.equal(isLowPower(1, 8), true, 'very little memory');
  assert.equal(isLowPower(8, 1), true, 'one core');
});

test('screenSwitch: the module loads (the switch itself needs a browser)', () => {
  assert.equal(typeof sw.ScreenSwitcher, 'function');
});

test('admin "Probar": the preview address carries the animation chosen now', () => {
  const { tryUrl } = admin;
  assert.equal(tryUrl('/?screen=loop&preview=1', { transition: 'wipe', transitionSpeed: 'slow' }), '/?screen=loop&preview=1&try=1&tr=wipe&trSpeed=slow');
  assert.equal(tryUrl('https://d.example/d/abc', { transition: 'random' }), 'https://d.example/d/abc?try=1&tr=random&trSpeed=normal');
});

test('Personalizado low-power look: the Pi by its user agent, GPU and client hints (switches are not affected)', () => {
  assert.equal(isArmLinuxUA('Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'), true);
  assert.equal(isArmLinuxUA('Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'), true);
  assert.equal(isArmLinuxUA('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'), false);
  assert.equal(isArmLinuxUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 aarch64'), false);
  assert.equal(isLowPowerGPU('ANGLE (Broadcom, V3D 7.1.7, OpenGL ES 3.1)'), true);
  assert.equal(isLowPowerGPU('Mali-G52'), true);
  assert.equal(isLowPowerGPU('ANGLE (Intel, Mesa Intel(R) UHD Graphics 620, OpenGL 4.6)'), false);
  assert.equal(isLowPowerGPU(''), false);
  assert.equal(isArmDesktop('arm', 'Linux', false), true);
  assert.equal(isArmDesktop('arm', 'macOS', false), false, 'Apple silicon is fast enough');
  assert.equal(isArmDesktop('arm', 'Android', true), false);
});

test('Software rendering: renderer names drawn by the CPU, and desktop chips that keep the full look', () => {
  for (const n of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.6, 256 bits)',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)']) {
    assert.equal(isSoftwareGPU(n), true, n);
    assert.equal(isHardwareGPU(n), false, n);
  }
  for (const n of ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2)']) {
    assert.equal(isSoftwareGPU(n), false, n);
    assert.equal(isHardwareGPU(n), true, n);
  }
  assert.equal(isHardwareGPU('ANGLE (Broadcom, V3D 7.1.7, OpenGL ES 3.1)'), false, 'a Pi is left to the probe');
  assert.equal(isHardwareGPU(''), false);
});
