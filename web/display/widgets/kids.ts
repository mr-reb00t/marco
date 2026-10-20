// Kids layouts (Familia, Modern style only; main.ts shows the big calendar with Classic):
//   Rutinas            one card per person with today's routines by time of day, progress and stars
//   Familia            a greeting, today's agenda, routines, today's meals, the to-do list and the next rewards
//   Semana de comidas  the meals of the week with today highlighted
// Plain HTML strings + setHTML like views.ts, and one fitting pass that drops whole rows (never cuts one in half).
// Taps on routines (only when the screen allows touch) go to `onToggle`; main.ts flips them at once and puts them
// back when the server says no.
import type { ChoreSlot, DisplayConfig, FamilyChoreView, FamilyDisplayState, FamilyMemberView, MealSlot, WeatherResponse } from '../../shared/types';
import { addDays, formatDateLine, formatTime, relativeDayLabel, weekdayName } from '../../shared/i18n';
import { qrSvg } from '../../shared/qr';
import { chipColors } from '../color';
import { todoMetaHtml } from './extras';
import { ctx } from '../ctx';
import { esc, setHTML } from '../dom';
import { isPreview, mediaUrl, withScreen } from '../identity';
import type { NEvent } from '../eventModel';
import { weatherIcon } from '../icons';
import type { Tick } from '../time';

/** Same ids as KIDS_PRESETS in server/core/familyCore.js (a test checks they match). */
export const KIDS_PRESETS = ['kidsRoutines', 'kidsFamily', 'kidsMeals'];
export const isKidsPreset = (p: string) => KIDS_PRESETS.includes(p);

export interface KidsData {
  family: FamilyDisplayState | null;
  events: NEvent[];
  weather: WeatherResponse | null;
  /** taps check routines off right now (the screen allows it, online, not private) */
  touch: boolean;
}

// The pieces below are shared with the Personalizado family cards (widgets/canvas/family.ts): plain functions that take
// the settings they read (a canvas item has its own), so the kids layouts draw exactly what they drew before.
export const SLOTS: ChoreSlot[] = ['morning', 'afternoon', 'evening', 'any'];
export const SLOT_EMOJI: Record<ChoreSlot, string> = { morning: '☀️', afternoon: '🌤️', evening: '🌙', any: '✨' };
/** The time of day on the TV's own clock (same rule as slotAt in familyCore.js), so it changes at 12:00 and 18:00. */
export const slotOf = (tick: Tick): Exclude<ChoreSlot, 'any'> => (tick.parts.hour < 12 ? 'morning' : tick.parts.hour < 18 ? 'afternoon' : 'evening');
export const SLOT_KEY: Record<ChoreSlot, string> = { morning: 'kidsMorning', afternoon: 'kidsAfternoon', evening: 'kidsEvening', any: 'kidsAnytime' };
export const MEAL_EMOJI: Record<MealSlot, string> = { breakfast: '🥣', lunch: '🍽️', snack: '🍎', dinner: '🍲' };
export const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2L18.5 7.8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const SKELETON: Record<string, string> = {
  kidsRoutines: '<header class="k-head"></header><div class="k-body kr-cards"></div>',
  kidsFamily: '<header class="k-head kf-head"></header><div class="k-body kf-cols"></div>',
  kidsMeals: '<header class="k-head km-head"></header><div class="k-body km-wrap"></div>',
};

/** Colours of one person, as inline custom properties (the soft fills are mixed in styles-kids.css). */
export function memberStyle(color: string): string {
  const c = chipColors(color);
  return `--kc:${esc(color)};--kc-tint:${c.tint};--kc-shade:${c.shade};--kc-on:${c.onSolid}`;
}
/**
 * Photo addresses that did not load (a server restarting, a photo just replaced, an address that expired): those
 * people show their emoji, and the photo is tried again after PHOTO_RETRY_MS.
 */
const brokenPhotos = new Map<string, number>();
const PHOTO_RETRY_MS = 5 * 60_000;
/**
 * A person's profile photo address for this display, or ''. Any same-origin path: /media/avatars/<id> gets this
 * display's screen and credential; a signed address (Marco Cloud: /m/...?e=&s=) is used as it is.
 */
const photoSrc = (m: Pick<FamilyMemberView, 'photo'>) => {
  const p = m.photo;
  if (!p || !p.startsWith('/') || p.startsWith('//')) return '';
  const src = p.startsWith('/media/') ? mediaUrl(withScreen(p)) : p;
  const failed = brokenPhotos.get(src);
  if (failed !== undefined) {
    if (Date.now() - failed < PHOTO_RETRY_MS) return '';
    brokenPhotos.delete(src);
  }
  return src;
};
/** Round avatar: the profile photo over the emoji (the emoji shows when there is none or it fails to load). */
export const avatar = (m: Pick<FamilyMemberView, 'avatar' | 'initials' | 'name' | 'photo'>) => {
  const src = photoSrc(m);
  const img = src ? `<img class="k-av-img" src="${esc(src)}" alt="" decoding="async" draggable="false">` : '';
  return `<span class="k-av${img ? ' has-photo' : ''}">${img}<i>${esc(m.avatar || m.initials || m.name.slice(0, 1))}</i></span>`;
};
/** A photo that does not load: the emoji instead, now and in the drawings of the next few minutes (one listener on `root`). */
export function watchAvatarErrors(root: HTMLElement): void {
  root.addEventListener('error', (e) => {
    const img = e.target as HTMLImageElement | null;
    if (!img || img.tagName !== 'IMG' || !img.classList.contains('k-av-img')) return;
    brokenPhotos.set(img.getAttribute('src') || '', Date.now());
    img.parentElement?.classList.remove('has-photo');
    img.remove();
  }, true);
}
export const hm = (ms: number, cfg: DisplayConfig = ctx.cfg) => formatTime(new Date(ms), ctx.tz, cfg.datetime.format24, cfg.datetime.showAmPm);

/** Hide rows until `box` stops overflowing (like views.ts): `pick()` gives the next one, `after(row)` runs after each. */
export function fitRows(box: HTMLElement, pick: () => HTMLElement | null, after?: (row: HTMLElement) => void): void {
  for (let guard = 0; guard < 300 && box.scrollHeight > box.clientHeight + 1; guard++) {
    const row = pick();
    if (!row) return;
    row.classList.add('fit-hide');
    after?.(row);
  }
}
/** Rows of `sel` still drawn (not dropped, not inside a folded or dropped group). */
export const visible = (root: ParentNode, sel: string) =>
  Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((r) => !r.classList.contains('fit-hide') && r.getClientRects().length > 0);

/**
 * The same state with one routine ticked or unticked (the tap shows at once; the server's answer replaces it).
 * Done counts and stars move with it.
 */
export function withToggle(f: FamilyDisplayState, choreId: string, done: boolean): FamilyDisplayState {
  const c = f.chores.find((x) => x.id === choreId);
  if (!c || c.done === done) return f;
  const d = done ? 1 : -1;
  return {
    ...f,
    chores: f.chores.map((x) => (x.id === choreId ? { ...x, done } : x)),
    members: f.members.map((m) => (m.id !== c.memberId ? m : {
      ...m,
      done: Math.max(0, Math.min(m.total, m.done + d)),
      points: m.points === null ? null : Math.max(0, m.points + d * c.points),
    })),
  };
}

/**
 * Taps on routines (`[data-chore]` buttons) inside `root`: one delegated listener, only while taps are allowed (no
 * touch handlers otherwise), and one tap per routine every 700 ms (a finger that bounces must not tick and untick).
 */
export class ChoreTaps {
  private on = false;
  private locks = new Map<string, number>();

  /** `onToggle(choreId, done)`: a tap on a routine. */
  constructor(private root: HTMLElement, private onToggle: (choreId: string, done: boolean) => void) {}

  get active(): boolean {
    return this.on;
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on) this.root.addEventListener('pointerup', this.onTap);
    else this.root.removeEventListener('pointerup', this.onTap);
    this.root.classList.toggle('k-touch', on);
  }

  private onTap = (e: PointerEvent): void => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-chore]');
    if (!btn || !this.on || !this.root.contains(btn)) return;
    const id = btn.dataset.chore || '';
    const now = Date.now();
    if (!id || now - (this.locks.get(id) ?? 0) < 700) return;
    this.locks.set(id, now);
    this.onToggle(id, btn.dataset.done !== '1');
  };
}

export function starsHtml(f: FamilyDisplayState, m: FamilyMemberView): string {
  if (!f.showPoints || !m.kid || m.points === null) return '';
  return `<span class="k-stars">⭐<b>${m.points}</b></span>`;
}

export function barHtml(m: FamilyMemberView): string {
  const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
  return `<div class="k-progress"><span class="k-bar"><i style="width:${pct}%"></i></span><span class="k-frac">${m.done}/${m.total}</span></div>`;
}

/** A routine: a big button when taps are on (`touch`), a plain row otherwise; `pop` = the routine tapped last. */
export function choreHtml(c: FamilyChoreView, f: FamilyDisplayState, o: { touch: boolean; pop: string; pill?: boolean; by?: string }): string {
  const pill = !!o.pill;
  const tag = o.touch ? 'button' : 'div';
  const attrs = o.touch ? ` type="button" data-chore="${esc(c.id)}" data-done="${c.done ? 1 : 0}"` : '';
  const pts = f.showPoints && c.points > 0 && !pill ? `<span class="k-pts">+${c.points}⭐</span>` : '';
  const cls = `k-chore${pill ? ' k-pill' : ''}${c.done ? ' is-done' : ''}${c.id === o.pop ? ' k-pop' : ''}`;
  return `<${tag} class="${cls}"${attrs}><span class="k-em">${esc(c.emoji || '⭐')}</span><span class="k-tt">${esc(c.title)}</span>${o.by ? `<span class="k-by">${esc(o.by)}</span>` : ''}${pts}<span class="k-check">${c.done ? CHECK : ''}</span></${tag}>`;
}

/** Nothing to show: private (family.privacy 'hide'), nobody in the family, or nothing for today. */
export function emptyStateHtml(f: FamilyDisplayState | null, cls = ''): string {
  const { t } = ctx;
  if (f?.hidden) return `<div class="k-empty k-private ${cls}"><span class="k-empty-em">🔒</span><b>${esc(t('privateMode'))}</b><span>${esc(t('kidsPrivate'))}</span></div>`;
  const none = !f || !f.members.length;
  return `<div class="k-empty ${cls}"><span class="k-empty-em">${none ? '👨‍👩‍👧‍👦' : '🌈'}</span><b>${esc(t(none ? 'kidsNoMembers' : 'kidsNone'))}</b></div>`;
}

/**
 * The Rutinas card of each person in `people`: who, stars and progress, and today's routines by time of day (earlier
 * groups that are all done fold to one line). Fitted afterwards by fitRoutineCards().
 */
export function routineCardsHtml(f: FamilyDisplayState, people: FamilyMemberView[], tick: Tick, o: { touch: boolean; pop: string; showDone?: boolean }): string[] {
  const nowIdx = SLOTS.indexOf(slotOf(tick));
  return people.map((m) => {
    const mine = f.chores.filter((c) => c.memberId === m.id && (o.showDone !== false || !c.done));
    const groups = SLOTS.map((slot) => ({ slot, list: mine.filter((c) => c.slot === slot) })).filter((g) => g.list.length);
    const slotsHtml = groups.map(({ slot, list }) => {
      const idx = SLOTS.indexOf(slot);
      const done = list.filter((c) => c.done).length;
      const label = `<span class="k-slot-em">${SLOT_EMOJI[slot]}</span><span class="k-slot-l">${esc(ctx.t(SLOT_KEY[slot]))}</span>`;
      const state = slot === 'any' ? 'is-any' : idx === nowIdx ? 'is-now' : idx < nowIdx ? 'is-past' : 'is-later';
      // earlier and all done: one short line with a check
      if (state === 'is-past' && done === list.length) {
        return `<div class="k-slot ${state} k-collapsed"><div class="k-slot-h">${label}<span class="k-slot-ok">${CHECK}</span></div></div>`;
      }
      // later today: open while there is room, folded to one line ("🌙 Noche 2") when there is not (fitRoutineCards);
      // the other groups fold the same way, but only when nothing else is left to drop
      const later = state === 'is-later';
      const count = done === list.length ? `<span class="k-slot-ok k-fold-only">${CHECK}</span>` : `<span class="k-slot-n k-fold-only">${list.length - done}</span>`;
      const head = `${label}${state === 'is-now' ? '<span class="k-now-dot"></span>' : ''}${count}`;
      return `<div class="k-slot ${state}${later ? ' k-foldable' : ''}" data-slot="${slot}"><div class="k-slot-h">${head}</div>
          <div class="k-list">${list.map((c) => choreHtml(c, f, { touch: o.touch, pop: o.pop })).join('')}<span class="k-more"></span></div></div>`;
    }).join('');
    const allDone = m.total > 0 && m.done >= m.total;
    return `<section class="k-card${allDone ? ' is-all-done' : ''}" style="${memberStyle(m.color)}">
        <div class="k-meta">${avatar(m)}<div class="k-who"><span class="k-name">${esc(m.name)}</span>${starsHtml(f, m)}</div>${barHtml(m)}</div>
        <div class="k-main">${allDone ? `<div class="k-banner">🎉 ${esc(ctx.t('kidsAllDone'))}</div>` : ''}<div class="k-slots">${slotsHtml}</div>${allDone ? '' : `<div class="k-all">${esc(ctx.t('kidsLeft', { n: m.total - m.done }))}</div>`}</div></section>`;
  });
}

/**
 * One person on one line (the Familia layout's routines card): avatar, name, stars, progress and the routine to do
 * next (of this time of day first), or "all done".
 */
export function personRowHtml(f: FamilyDisplayState, m: FamilyMemberView, tick: Tick, o: { touch: boolean; pop: string; next?: boolean }): string {
  const slotNow = slotOf(tick);
  const pending = f.chores.find((c) => c.memberId === m.id && !c.done && (c.slot === slotNow || c.slot === 'any'))
    ?? f.chores.find((c) => c.memberId === m.id && !c.done);
  const nextHtml = o.next === false ? '' : m.done >= m.total
    ? `<div class="kf-next is-done">🎉 ${esc(ctx.t('kidsAllDone'))}</div>`
    : pending ? choreHtml(pending, f, { touch: o.touch, pop: o.pop, pill: true }) : '';
  return `<div class="kf-row" style="${memberStyle(m.color)}">${avatar(m)}<div class="kf-row-main"><div class="kf-row-top"><span class="k-name">${esc(m.name)}</span>${starsHtml(f, m)}</div>${barHtml(m)}${nextHtml}</div></div>`;
}

/** Next reward of each person with one, and how far they are (only when stars are shown). */
export function rewardRowsHtml(f: FamilyDisplayState, max = Infinity): string[] {
  const { t } = ctx;
  const nr = f.nextReward;
  if (!nr || !f.showPoints) return [];
  return f.members.filter((m) => nr[m.id]).slice(0, max).map((m) => {
    const r = nr[m.id];
    const pct = Math.round(Math.min(1, (r.cost - r.missing) / r.cost) * 100);
    const note = r.missing > 1 ? t('kidsStarsLeft', { n: r.missing }) : r.missing === 1 ? t('kidsStarsLeft1') : t('kidsRewardReady');
    return `<div class="kf-reward${r.missing ? '' : ' is-ready'}" style="${memberStyle(m.color)}">${avatar(m)}<div class="kf-row-main"><div class="kf-row-top"><span class="kf-rw-t">${esc(r.emoji)} ${esc(r.title)}</span></div><div class="k-progress"><span class="k-bar"><i style="width:${pct}%"></i></span><span class="k-frac">${esc(note)}</span></div></div></div>`;
  });
}

/** The meals of `date` (one row per meal of the day that has one). */
export function mealRowsHtml(meals: NonNullable<FamilyDisplayState['meals']>, date: string): string[] {
  const { t } = ctx;
  const day = meals.days.find((x) => x.date === date);
  return meals.slots.filter((s) => day?.meals[s]).map((s) =>
    `<div class="kf-meal"><span class="kf-meal-em">${MEAL_EMOJI[s]}</span><span class="kf-meal-l">${esc(t(`meal_${s}`))}</span><span class="kf-meal-t">${esc(day!.meals[s]!)}</span></div>`);
}

/**
 * The meals grid: a column per day and a row per meal (`rows` false), or a row per day (`rows` true, portrait).
 * `days` = the days shown (default the whole week the server sent).
 */
export function mealsGridHtml(meals: NonNullable<FamilyDisplayState['meals']>, today: string, rows: boolean, days = meals.days): string {
  const { t, lang } = ctx;
  const slots = meals.slots;
  const cell = (text: string | undefined) => (text ? `<div class="km-cell"><span>${esc(text)}</span></div>` : `<div class="km-cell is-empty"><span>${esc(t('kidsNoMeal'))}</span></div>`);
  const slotHead = (s: MealSlot) => `<div class="km-slot"><span class="km-slot-em">${MEAL_EMOJI[s]}</span><span>${esc(t(`meal_${s}`))}</span></div>`;
  const dayHead = (date: string) => {
    const n = Number(date.slice(8, 10));
    // portrait has room for the long name ("Segunda" without "-feira" in Portuguese, so it stays on one line)
    const wd = rows ? weekdayName(lang, date, 'long').replace(/-feira$/i, '') : weekdayName(lang, date, 'short');
    return `<div class="km-day"><span class="km-wd">${esc(wd)}</span><span class="km-dn">${n}</span>${date === today ? `<span class="km-today">${esc(t('today'))}</span>` : ''}</div>`;
  };
  if (!rows) {
    // a column per day, a row per meal; today's column sits on a tinted card
    const cols = days.map((day) => `<div class="km-col${day.date === today ? ' is-today' : ''}${day.date < today ? ' is-past' : ''}">${dayHead(day.date)}${slots.map((s) => cell(day.meals[s])).join('')}</div>`);
    return `<div class="km-grid" style="--km-rows:${slots.length}"><div class="km-col km-labels"><div class="km-day"></div>${slots.map(slotHead).join('')}</div>${cols.join('')}</div>`;
  }
  // a row per day, a column per meal
  const list = days.map((day) => `<div class="km-row${day.date === today ? ' is-today' : ''}${day.date < today ? ' is-past' : ''}">${dayHead(day.date)}${slots.map((s) => cell(day.meals[s])).join('')}</div>`);
  return `<div class="km-grid is-rows" style="--km-cols:${slots.length}"><div class="km-row km-labels"><div class="km-day"></div>${slots.map(slotHead).join('')}</div>${list.join('')}</div>`;
}

/**
 * Fit Rutinas cards (`.k-card` in `body`) to their room: whole routines go, then groups fold, never half a row.
 */
export function fitRoutineCards(body: HTMLElement): void {
  const cards = Array.from(body.querySelectorAll<HTMLElement>('.k-card'));
  for (const r of Array.from(body.querySelectorAll<HTMLElement>('.fit-hide'))) r.classList.remove('fit-hide');
  for (const r of Array.from(body.querySelectorAll<HTMLElement>('.k-fold, .k-squeeze'))) r.classList.remove('k-fold', 'k-squeeze');
  for (const m of Array.from(body.querySelectorAll<HTMLElement>('.k-more'))) m.textContent = '';
  const over = (box: HTMLElement) => box.scrollHeight > box.clientHeight + 1;
  // "+N más" under a group counts its routines still to do that were dropped
  const more = (list: Element) => {
    const k = list.querySelectorAll('.k-chore.fit-hide:not(.is-done)').length;
    list.querySelector('.k-more')!.textContent = k ? ctx.t('more', { n: k }) : '';
  };
  // every change is kept, so the ones that freed more room than needed can be taken back at the end
  type Change = { el: HTMLElement; cls: string };
  const apply = (log: Change[], el: HTMLElement, cls: string) => {
    el.classList.add(cls);
    log.push({ el, cls });
    const list = el.closest('.k-list');
    if (list) more(list);
    return true;
  };
  const FOLD_ORDER = ['is-past', 'is-any', 'is-now'];
  // One change on a card, least useful first. Folded lines are never dropped: they say what is hidden.
  //   routines already done (a group left with none folds), earlier groups that are all done, later groups folded
  //   (the evening first), the last routine of the longest group ("+N más"), the other groups folded (earlier,
  //   all day, now), and as a last resort the whole list as one line ("3 por hacer").
  const step = (c: HTMLElement, log: Change[]): boolean => {
    if (c.classList.contains('k-squeeze')) return false;
    const done = visible(c, '.k-slot:not(.k-fold) .k-chore.is-done').pop();
    if (done) {
      const list = done.closest('.k-list')!;
      return visible(list, '.k-chore').length > 1 ? apply(log, done, 'fit-hide') : apply(log, done.closest<HTMLElement>('.k-slot')!, 'k-fold');
    }
    const past = visible(c, '.k-collapsed').pop();
    if (past) return apply(log, past, 'fit-hide');
    const later = visible(c, '.k-foldable:not(.k-fold)').sort((a, b) => SLOTS.indexOf(b.dataset.slot as ChoreSlot) - SLOTS.indexOf(a.dataset.slot as ChoreSlot))[0];
    if (later) return apply(log, later, 'k-fold');
    let best: HTMLElement | null = null, n = 1;
    for (const l of visible(c, '.k-slot:not(.k-fold) .k-list')) {
      const rows = visible(l, '.k-chore');
      if (rows.length > n) {
        n = rows.length;
        best = rows[rows.length - 1];
      }
    }
    if (best) return apply(log, best, 'fit-hide');
    const open = visible(c, '.k-slot:not(.k-fold):not(.k-collapsed)')
      .sort((a, b) => FOLD_ORDER.findIndex((x) => a.classList.contains(x)) - FOLD_ORDER.findIndex((x) => b.classList.contains(x)))[0];
    if (open) return apply(log, open, 'k-fold');
    return apply(log, c, 'k-squeeze');
  };
  // take back the changes that are no longer needed, the most useful first (the last ones made)
  const giveBack = (box: HTMLElement, log: Change[]) => {
    for (let i = log.length - 1; i >= 0; i--) {
      const { el, cls } = log[i];
      el.classList.remove(cls);
      const list = el.closest('.k-list');
      if (list) more(list);
      if (over(box)) {
        el.classList.add(cls);
        if (list) more(list);
      }
    }
  };
  for (const c of cards) {
    const box = c.querySelector<HTMLElement>('.k-slots') ?? c;
    const log: Change[] = [];
    for (let guard = 0; guard < 300 && over(box) && step(c, log); guard++);
    if (log.length) giveBack(box, log);
  }
  // portrait: the rows grow with their routines, so the whole list may still be too tall; the tallest card gives
  // first, until everyone fits
  const log: Change[] = [];
  const height = (c: HTMLElement) => (c.classList.contains('k-squeeze') ? -1 : c.getBoundingClientRect().height);
  for (let guard = 0; guard < 600 && over(body); guard++) {
    const order = [...cards].sort((a, b) => height(b) - height(a));
    if (!order.some((c) => step(c, log))) break;
  }
  if (log.length) giveBack(body, log);
}

export class Kids {
  private kind = '';
  private taps: ChoreTaps;
  /** routine tapped last: it gets the small pop once */
  private popId = '';
  private qrCache = { url: '', svg: '' };
  private last: { d: KidsData; tick: Tick } | null = null;

  /** `onToggle(choreId, done)`: a tap on a routine. */
  constructor(private root: HTMLElement, onToggle: (choreId: string, done: boolean) => void) {
    watchAvatarErrors(root);
    this.taps = new ChoreTaps(root, onToggle);
  }

  /** Build the skeleton of a kids layout (empty for every other layout). */
  setPreset(preset: string): void {
    const kind = isKidsPreset(preset) ? preset : '';
    if (kind === this.kind) return;
    this.kind = kind;
    this.taps.set(false);
    this.root.className = kind ? `kids kids-${kind}` : 'kids';
    this.root.innerHTML = SKELETON[kind] ?? '';
  }

  get active(): boolean {
    return !!this.kind;
  }

  render(d: KidsData, tick: Tick): void {
    this.last = { d, tick };
    if (!this.kind) return;
    this.taps.set(d.touch && !!d.family?.touch);
    if (this.kind === 'kidsRoutines') this.routines(d, tick);
    else if (this.kind === 'kidsFamily') this.familyDay(d, tick);
    else this.meals(d, tick);
    this.popId = '';
    this.fit();
  }

  /** Show a tap at once (the row pops when it is drawn next). */
  pop(choreId: string): void {
    this.popId = choreId;
  }

  // ------------------------------------------------------------------------------------------------ shared pieces
  private qr(url: string): string {
    if (this.qrCache.url !== url) this.qrCache = { url, svg: qrSvg(url, { dark: '#111114', light: '#ffffff' }) };
    return this.qrCache.svg;
  }

  private qrTile(f: FamilyDisplayState | null): string {
    // the family data has the say (a revoked link is null there while the config still has the old one); the
    // admin's preview follows the unsaved settings, which only its config carries
    const url = isPreview || !f ? ctx.cfg.family?.qrUrl ?? null : f.qrUrl;
    if (!url || f?.private) return '';
    return `<div class="k-qr"><div class="k-qr-img">${this.qr(url)}</div><span>${esc(ctx.t('kidsScan'))}</span></div>`;
  }

  private weather(w: WeatherResponse | null): string {
    if (!ctx.cfg.weather.enabled || !w?.current) return '';
    const c = w.current;
    const temp = Number.isFinite(c.temp) ? `${Math.round(c.temp)}°` : '–';
    return `<div class="k-wx"><span class="k-wx-ic">${weatherIcon(c.code, c.isDay, { animated: false })}</span><span class="k-wx-t">${temp}</span></div>`;
  }

  private dateLine(key: string): string {
    return formatDateLine(ctx.lang, key, ctx.cfg.datetime.dateFormat, ctx.cfg.datetime.dateCustom);
  }

  // ------------------------------------------------------------------------------------------------ Rutinas
  private routines(d: KidsData, tick: Tick): void {
    const f = d.family;
    const head = this.root.querySelector<HTMLElement>('.k-head')!;
    setHTML(head, `<div class="k-when"><span class="k-date">${esc(this.dateLine(tick.dayKey))}</span><span class="k-time">${esc(hm(tick.now.getTime()))}</span></div>
      <div class="k-side">${this.weather(d.weather)}${this.qrTile(f)}</div>`);
    const body = this.root.querySelector<HTMLElement>('.kr-cards')!;
    const people = f && !f.hidden ? f.members.filter((m) => m.total > 0) : [];
    body.style.setProperty('--kr-n', String(Math.max(1, people.length)));
    body.classList.toggle('kr-many', people.length >= 5);
    if (!people.length) {
      setHTML(body, emptyStateHtml(f));
      return;
    }
    const cards = routineCardsHtml(f!, people, tick, { touch: this.taps.active, pop: this.popId });
    setHTML(body, cards.join(''));
  }

  // ------------------------------------------------------------------------------------------------ Familia
  private familyDay(d: KidsData, tick: Tick): void {
    const { t } = ctx;
    const f = d.family;
    const nowMs = tick.now.getTime();
    const today = tick.dayKey;
    const h = tick.parts.hour;
    const greet = t(h < 13 ? 'greetMorning' : h < 20 ? 'greetAfternoon' : 'greetEvening');
    const left = d.events.filter((e) => e.timed && e.startKey === today && e.endMs > nowMs).length;
    const summary = [left === 0 ? t('kidsNoEventsLeft') : left === 1 ? t('kidsEventsLeft1') : t('kidsEventsLeft', { n: left })];
    const people = f && !f.hidden ? f.members.filter((m) => m.total > 0) : [];
    const total = people.reduce((s, m) => s + m.total, 0);
    if (total) summary.push(t('kidsRoutinesDone', { done: people.reduce((s, m) => s + m.done, 0), total }));
    setHTML(this.root.querySelector<HTMLElement>('.k-head')!, `<div class="kf-greet"><h1>${esc(greet)}</h1><p>${esc(summary.join(' · '))}</p></div>
      <div class="k-side"><div class="k-when"><span class="k-time">${esc(hm(nowMs))}</span><span class="k-date">${esc(this.dateLine(today))}</span></div>${this.weather(d.weather)}${this.qrTile(f)}</div>`);

    const card = (cls: string, icon: string, title: string, body: string) =>
      `<section class="kf-card ${cls}"><h2 class="kf-h"><span>${icon}</span>${esc(title)}</h2>${body}</section>`;

    // today: all-day pills, what is left of the timed events, then tomorrow's first two
    const byCal = new Map((f?.members ?? []).filter((m) => m.calendarId).map((m) => [m.calendarId as string, m]));
    const evRow = (e: NEvent, extra = '') => {
      const m = byCal.get(e.ev.sourceId);
      const on = e.startMs <= nowMs && e.endMs > nowMs;
      const who = m ? `<span class="kf-ev-who" style="${memberStyle(m.color)}">${avatar(m)}</span>` : '';
      return `<div class="kf-ev${on ? ' is-now' : ''}${extra}" style="--ec:${esc(e.color)}"><b class="kf-ev-tm">${esc(on ? t('happeningNow') : hm(e.startMs))}</b><span class="kf-ev-tt">${e.emoji ? `<i>${esc(e.emoji)}</i>` : ''}${esc(e.title)}</span>${who}</div>`;
    };
    const allDay = d.events.filter((e) => e.bar && e.spanFirst <= today && e.spanLast >= today);
    const timed = d.events.filter((e) => e.timed && e.startKey === today && e.endMs > nowMs).sort((a, b) => a.startMs - b.startMs);
    const tomorrow = addDays(today, 1);
    const next = d.events.filter((e) => e.timed && e.startKey === tomorrow).sort((a, b) => a.startMs - b.startMs).slice(0, 2);
    const pills = allDay.length ? `<div class="kf-pills">${allDay.map((e) => `<span class="kf-pill" style="--ec:${esc(e.color)}">${e.emoji ? `<i>${esc(e.emoji)}</i>` : ''}${esc(e.title)}</span>`).join('')}</div>` : '';
    const todayRows = timed.length ? timed.map((e) => evRow(e)).join('') : `<div class="kf-none">${esc(t('nothingMoreToday'))}</div>`;
    const tmr = next.length ? `<div class="kf-sub kf-tmr">${esc(relativeDayLabel(ctx.lang, tomorrow, today, false))}</div>${next.map((e) => evRow(e, ' kf-tmr')).join('')}` : '';
    const agenda = card('kf-today', '📅', t('today'), `${pills}<div class="kf-list">${todayRows}${tmr}</div><div class="kf-more"></div>`);

    // routines: one row per person
    let routines: string;
    if (f?.hidden || !people.length) routines = card('kf-routines', '⭐', t('kidsRoutines'), emptyStateHtml(f, 'is-small'));
    else {
      const rows = people.map((m) => personRowHtml(f!, m, tick, { touch: this.taps.active, pop: this.popId }));
      // five or six people: two people a row (landscape), so nobody is left out
      routines = card(`kf-routines${people.length > 4 ? ' is-many' : ''}`, '⭐', t('kidsRoutines'), `<div class="kf-list">${rows.join('')}</div><div class="kf-more"></div>`);
    }

    // today's meals, to-dos, rewards
    const side: string[] = [];
    const meals = f?.meals;
    if (meals && ctx.cfg.family?.mealsEnabled !== false) {
      const rows = mealRowsHtml(meals, today);
      side.push(card('kf-meals', '🍽️', t('kidsMealsToday'), rows.length ? `<div class="kf-list">${rows.join('')}</div>` : `<div class="kf-none">${esc(t('kidsNoMealsDay'))}</div>`));
    }
    const todo = ctx.cfg.todo;
    const items = (todo.items || []).filter((i) => i.text?.trim());
    if (todo.enabled && items.length) {
      const sorted = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];
      const rows = sorted.map((i) => `<div class="kf-task${i.done ? ' is-done' : ''}"><span class="k-check">${i.done ? CHECK : ''}</span><span>${esc(i.text)}</span>${todoMetaHtml(i)}</div>`);
      side.push(card('kf-tasks', '✅', t('kidsTasks'), `<div class="kf-list">${rows.join('')}</div><div class="kf-more"></div>`));
    }
    if (f) {
      const rows = rewardRowsHtml(f);
      if (rows.length) side.push(card('kf-rewards', '🎁', t('kidsRewards'), `<div class="kf-list">${rows.join('')}</div>`));
    }
    setHTML(this.root.querySelector<HTMLElement>('.kf-cols')!,
      `<div class="kf-col">${agenda}</div><div class="kf-col">${routines}</div>${side.length ? `<div class="kf-col">${side.join('')}</div>` : ''}`);
    this.root.querySelector<HTMLElement>('.kf-cols')!.style.setProperty('--kf-n', String(side.length ? 3 : 2));
  }

  private fitFamily(): void {
    const box = this.root.querySelector<HTMLElement>('.kf-cols');
    if (!box) return;
    for (const r of Array.from(box.querySelectorAll<HTMLElement>('.fit-hide'))) r.classList.remove('fit-hide');
    for (const m of Array.from(box.querySelectorAll<HTMLElement>('.kf-more'))) m.textContent = '';
    const portrait = document.getElementById('app')?.classList.contains('portrait');
    const cols = portrait ? [box] : Array.from(box.querySelectorAll<HTMLElement>('.kf-col'));
    for (const col of cols) {
      // rewards first, then tomorrow, then rows from the end of the longest card; the routines give their "next
      // routine" pills, then their bars, then whole people from the end ("+N más", one person always stays)
      const pick = (): HTMLElement | null => {
        const rw = visible(col, '.kf-rewards')[0];
        if (rw) return rw;
        const tm = visible(col, '.kf-tmr').pop();
        if (tm) return tm;
        let best: HTMLElement | null = null, n = 1;
        for (const c of Array.from(col.querySelectorAll<HTMLElement>('.kf-card'))) {
          const rows = visible(c, '.kf-ev, .kf-task, .kf-meal');
          if (rows.length > n) {
            n = rows.length;
            best = rows[rows.length - 1];
          }
        }
        if (best) return best;
        const next = visible(col, '.kf-row .k-chore, .kf-row .kf-next').pop();
        if (next) return next;
        const bar = visible(col, '.kf-row .k-progress').pop();
        if (bar) return bar;
        const people = visible(col, '.kf-row');
        return people.length > 1 ? people[people.length - 1] : null;
      };
      fitRows(col, pick, (row) => {
        // "Mañana" goes with its last event
        const sub = col.querySelector<HTMLElement>('.kf-sub.kf-tmr');
        if (sub && !visible(col, '.kf-ev.kf-tmr').length) sub.classList.add('fit-hide');
        const c = row.closest('.kf-card');
        const more = c?.querySelector('.kf-more');
        if (!c || !more) return;
        const k = c.querySelectorAll('.kf-ev.fit-hide:not(.kf-tmr), .kf-task.fit-hide, .kf-row.fit-hide').length;
        more.textContent = k ? ctx.t('more', { n: k }) : '';
      });
    }
  }

  // ------------------------------------------------------------------------------------------------ Semana de comidas
  private meals(d: KidsData, tick: Tick): void {
    const { t } = ctx;
    const f = d.family;
    const nowMs = tick.now.getTime();
    const today = tick.dayKey;
    const nx = d.events.filter((e) => e.timed && e.startKey === today && e.endMs > nowMs).sort((a, b) => a.startMs - b.startMs)[0];
    const next = nx
      ? `<div class="km-next" style="--ec:${esc(nx.color)}"><b>${esc(nx.startMs <= nowMs ? t('happeningNow') : hm(nx.startMs))}</b><span>${nx.emoji ? `${esc(nx.emoji)} ` : ''}${esc(nx.title)}</span></div>`
      : `<div class="km-next is-empty"><span>${esc(t('nothingMoreToday'))}</span></div>`;
    setHTML(this.root.querySelector<HTMLElement>('.k-head')!, `<div class="k-when"><span class="k-time">${esc(hm(nowMs))}</span><span class="k-date">${esc(this.dateLine(today))}</span></div>
      ${next}<div class="k-side">${this.weather(d.weather)}${this.qrTile(f)}</div>`);
    const wrap = this.root.querySelector<HTMLElement>('.km-wrap')!;
    const meals = f?.meals;
    if (!meals || !meals.slots.length) {
      setHTML(wrap, `<div class="k-empty"><span class="k-empty-em">🍽️</span><b>${esc(t('kidsMealsOff'))}</b></div>`);
      return;
    }
    const html = mealsGridHtml(meals, today, !!document.getElementById('app')?.classList.contains('portrait'));
    setHTML(wrap, `<h2 class="km-title">${esc(t('kidsMealsWeek'))}</h2>${html}`);
  }

  /** Drop whatever does not fit (after layout changes: resize, fonts). */
  fit(): void {
    if (this.kind === 'kidsRoutines') {
      const body = this.root.querySelector<HTMLElement>('.kr-cards');
      if (body) fitRoutineCards(body);
    }
    else if (this.kind === 'kidsFamily') this.fitFamily();
  }

  /** Draw again with the last data (the clock of a new minute, a resize). */
  redraw(tick: Tick): void {
    if (this.last) this.render(this.last.d, tick);
  }
}
