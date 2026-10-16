// Personalizado "Familia y hogar": family members, routines, points, rewards and today's chores, the meals of today
// and of the week, upcoming birthdays, the highlights pills and the announcement on screen.
//
// - The family cards draw with the kids layouts' own pieces (widgets/kids.ts: avatars, routines, rows, rewards, meals),
//   from the same data (GET /api/display/family, main.ts), so privacy works exactly as there: on a private screen the
//   server sends initials, no photos, no stars, rewards or taps, and with family.privacy 'hide' no members or routines
//   at all (the cards then say "Modo privado"). Every piece of text in those builders goes through esc().
// - Taps on routines go through env.toggleChore(), the kids layouts' path with its trust rules (the screen's
//   family.touch setting, online, not private, never in the admin's preview; the server checks the credential too).
// - Birthdays come from the screen's events (the Cumpleaños calendar), highlights reuse widgets/highlights.ts, and the
//   announcement card shows the newest announcement of widgets/alerts.ts; those three write their text as text.
import { canvasCards } from '../../../../server/core/canvasCore.js';
import type { FamilyDisplayState, FamilyMemberView } from '../../../shared/types';
import { diffDays, monthName, keyToUTC, weekdayName } from '../../../shared/i18n';
import { ctx } from '../../ctx';
import { esc, setHTML } from '../../dom';
import { Highlights, isBirthday } from '../highlights';
import {
  avatar, barHtml, ChoreTaps, choreHtml, emptyStateHtml, fitRoutineCards, fitRows, MEAL_EMOJI, mealRowsHtml, mealsGridHtml, memberStyle,
  personRowHtml, rewardRowsHtml, routineCardsHtml, starsHtml, visible, watchAvatarErrors,
} from '../kids';
import type { AdapterBox, AdapterEnv, CanvasAdapter, CanvasTopic } from './types';

type Props = Record<string, any>;

/** A small centred note (no data, private, turned off). Text through esc(). */
const note = (emoji: string, text: string, cls = '') =>
  `<div class="k-empty is-small${cls ? ` ${cls}` : ''}"><span class="k-empty-em">${esc(emoji)}</span><b>${esc(text)}</b></div>`;
const privateNote = () => note('🔒', ctx.t('privateMode'), 'k-private');

/** What a family card says instead of its content (Familia off, not loaded yet, private), or null to draw it. */
function gate(env: AdapterEnv): { html: string } | null {
  if (!env.cfg().family?.enabled) return { html: note('👨‍👩‍👧‍👦', ctx.t('cvFamilyOff')) };
  if (!env.family().state) return { html: '' };
  return null;
}

/** Members of the screen, only those the item picked (null = all), in the item's order when it picked some. */
function membersOf(f: FamilyDisplayState, ids: unknown): FamilyMemberView[] {
  if (!Array.isArray(ids)) return f.members;
  return ids.map((id) => f.members.find((m) => m.id === id)).filter((m): m is FamilyMemberView => !!m);
}

/**
 * Drop rows of `sel` from the end of `list` until `root` stops overflowing (one always stays), with "+N más" in
 * root's .kf-more (counted as it goes, so the line itself has room). `first` gives rows to drop before those.
 */
function fitList(root: HTMLElement, list: HTMLElement | null, sel: string, first?: () => HTMLElement | null | undefined): void {
  if (!list) return;
  for (const r of Array.from(list.querySelectorAll('.fit-hide'))) r.classList.remove('fit-hide');
  const more = root.querySelector<HTMLElement>('.kf-more');
  if (more) more.textContent = '';
  fitRows(root, () => {
    const pre = first?.();
    if (pre) return pre;
    const left = visible(list, sel);
    return left.length > 1 ? left[left.length - 1] : null;
  }, () => {
    if (!more) return;
    const k = list.querySelectorAll(`${sel}.fit-hide`).length;
    more.textContent = k ? ctx.t('more', { n: k }) : '';
  });
  // down to one row that only fits alone (a small box, a busy day): the row stays whole and the "+N more" line goes
  if (more?.textContent && root.scrollHeight > root.clientHeight + 1) more.textContent = '';
}

/**
 * A box one fine row high (only the fine grid has it, widgets/canvas.ts miniMark): the card is one line, its rows side
 * by side (styles-canvas-mini.css).
 */
const isLine = (root: HTMLElement) => root.dataset.mini !== undefined && root.dataset.mh === '1';

/**
 * fitList for a card on one line: rows drop from the end while the line is wider than the card, with "+N" after
 * them; the last row left shrinks (its text ends in …) instead of going.
 */
function fitAcross(root: HTMLElement, list: HTMLElement | null, sel: string): void {
  if (!list) return;
  for (const r of Array.from(list.querySelectorAll('.fit-hide'))) r.classList.remove('fit-hide');
  list.classList.remove('is-one');
  const more = root.querySelector<HTMLElement>('.kf-more');
  if (more) more.textContent = '';
  const over = () => list.scrollWidth > list.clientWidth + 1 || root.scrollWidth > root.clientWidth + 1;
  for (let guard = 0; guard < 60 && over(); guard++) {
    const left = visible(list, sel);
    if (left.length <= 1) break;
    left[left.length - 1].classList.add('fit-hide');
    const k = list.querySelectorAll(`${sel}.fit-hide`).length;
    if (more) more.textContent = k ? `+${k}` : '';
  }
  // one row left that is still too wide: it shrinks, and "+N" gives it the room
  if (over()) {
    list.classList.add('is-one');
    if (more) more.textContent = '';
  }
}

/** fitList, or fitAcross for a card on one line. */
const fitRowsOf = (root: HTMLElement, list: HTMLElement | null, sel: string, first?: () => HTMLElement | null | undefined) =>
  (isLine(root) ? fitAcross(root, list, sel) : fitList(root, list, sel, first));

interface Spec {
  cls: string;
  /** body html (from the kids builders, text escaped); '' = nothing yet; null = nothing to show (card hidden) */
  html(env: AdapterEnv, box: AdapterBox | null, o: { touch: boolean; pop: string }): string | null;
  /** drop what does not fit (after every draw and resize) */
  fit?(root: HTMLElement, env: AdapterEnv): void;
  /** classes of the card's shape in its box, set before it draws (tiles in a big box) */
  shape?(root: HTMLElement, box: AdapterBox, env: AdapterEnv): void;
  /** data topics it draws again on */
  topics: CanvasTopic[];
  /** draw again every minute (the time of day of routines, today's meals, "in 3 days") */
  minute?: boolean;
  /** routines may be ticked off by touch */
  taps?: boolean;
}

/** The card's width and height on screen in rem (the box handed to layout is in its own pixels: smaller when it grows, larger at a text size under 100 %). */
function onScreen(root: HTMLElement, b: AdapterBox): [number, number] {
  const r = root.getBoundingClientRect();
  return [r.width / b.rem, r.height / b.rem];
}

/** A family card: draws `spec.html` into the card body, taps through the kids' ChoreTaps, fits on resize. */
function familyCard(spec: Spec): () => CanvasAdapter {
  return () => {
    let env: AdapterEnv;
    let root: HTMLElement;
    let taps: ChoreTaps | null = null;
    let box: AdapterBox | null = null;
    let pop = '';
    let empty = false;
    const render = () => {
      const touch = !!spec.taps && env.family().touch;
      taps?.set(touch);
      const html = spec.html(env, box, { touch, pop });
      pop = '';
      empty = html === null;
      setHTML(root, html ?? '');
      spec.fit?.(root, env);
    };
    return {
      mount(r, e) {
        root = r;
        env = e;
        root.classList.add('cv-fam', spec.cls);
        watchAvatarErrors(root);
        if (spec.taps) {
          taps = new ChoreTaps(root, (id, done) => {
            pop = id;
            env.toggleChore(id, done);
          });
        }
        render();
      },
      update: () => render(),
      layout(b) {
        const shape = !box || box.w !== b.w || box.h !== b.h;
        box = b;
        // a narrow box (a wide sidebar): the chore's own icon goes, so its name reads
        root.classList.toggle('is-narrow', b.w / b.rem < 32);
        spec.shape?.(root, b, env);
        if (shape) render();
        // the same box laid out again (the fonts came in, the card grew): what fits is worked out again
        else spec.fit?.(root, env);
      },
      tick(t) {
        if (spec.minute && t.minuteChanged) render();
      },
      data(topic) {
        if (topic === 'config' || topic === 'family' || spec.topics.includes(topic)) render();
      },
      empty: () => empty,
      destroy() {
        taps?.set(false);
        root.textContent = '';
      },
    };
  };
}

/** Another card of `kind` on the same screen (the canvas the card is on), optionally one that `ok` accepts. */
function onSameScreen(env: AdapterEnv, kind: string, ok: (it: { props: unknown }) => boolean = () => true): boolean {
  const me = env.item().id;
  const items = canvasCards(env.cfg().canvas?.items) as { id: string; kind: string; props: unknown }[];
  return items.some((it) => it.id !== me && it.kind === kind && ok(it));
}

// ------------------------------------------------------------------------------------------------ members
const members = familyCard({
  cls: 'cvf-members',
  topics: [],
  html(env) {
    const g = gate(env);
    if (g) return g.html;
    const f = env.family().state!;
    const p = env.item().props as Props;
    const list = membersOf(f, p.memberIds);
    if (f.hidden || !list.length) return emptyStateHtml(f, 'is-small');
    const pts = p.showPoints !== false;
    // the day's progress only when no Rutinas card on the screen shows it already (each value said once)
    const bars = !onSameScreen(env, 'family.routines');
    const rows = list.map((m) => `<div class="cvf-person" style="${memberStyle(m.color)}">${avatar(m)}<span class="k-name">${esc(m.name)}</span>${pts ? starsHtml(f, m) : ''}${m.total && bars ? barHtml(m) : ''}</div>`);
    return `<div class="cvf-people" style="--cvf-n:${list.length}">${rows.join('')}</div><div class="kf-more"></div>`;
  },
  // a box past the named sizes: as many faces a row as gives each the most room (a face and its name are about 1.6
  // times as tall as wide), so they grow in a grid of their own instead of one long row or a lone face on a row
  shape(root, b, env) {
    const f = env.family().state;
    const n = f && !f.hidden ? membersOf(f, (env.item().props as Props).memberIds).length : 0;
    let best = 0;
    if (root.dataset.room !== undefined && n > 1 && !isLine(root)) {
      const [w, h] = onScreen(root, b);
      let score = 0;
      for (let c = 1; c <= n; c++) {
        const s = Math.min(w / c, h / Math.ceil(n / c) / 1.6);
        if (s > score * 1.02) [score, best] = [s, c];
      }
    }
    root.classList.toggle('is-grid', best > 0);
    root.style.setProperty('--cvf-cols', String(best || 1));
  },
  fit(root) {
    const grid = root.querySelector<HTMLElement>('.cvf-people');
    if (!grid) return;
    grid.classList.remove('is-compact', 'is-tiny');
    for (const r of Array.from(grid.querySelectorAll('.fit-hide'))) r.classList.remove('fit-hide');
    // one line: each face with its name, then faces alone, then people from the end ("+N")
    if (isLine(root)) {
      grid.classList.add('is-compact');
      if (grid.scrollWidth > grid.clientWidth + 1) grid.classList.add('is-tiny');
      return fitAcross(root, grid, '.cvf-person');
    }
    const over = () => root.scrollHeight > root.clientHeight + 1 || grid.scrollWidth > grid.clientWidth + 1;
    // first the bars go, then the names, then people from the end ("+N más", one always stays)
    if (over()) grid.classList.add('is-compact');
    if (over()) grid.classList.add('is-tiny');
    fitList(root, grid, '.cvf-person');
  },
});

// ------------------------------------------------------------------------------------------------ routines
/** One person, or everyone: a Rutinas card each when the card is wide enough for them all, else a row each. */
const routines = familyCard({
  cls: 'cvf-routines',
  topics: [],
  minute: true,
  taps: true,
  html(env, box, o) {
    const g = gate(env);
    if (g) return g.html;
    const f = env.family().state!;
    const p = env.item().props as Props;
    const one = typeof p.memberId === 'string' ? p.memberId : null;
    const people = f.hidden ? [] : f.members.filter((m) => m.total > 0 && (!one || m.id === one));
    if (!people.length) return emptyStateHtml(f, 'is-small');
    const tick = env.now();
    const rem = box?.rem || 10;
    const cards = people.length === 1 || (!!box && box.w / rem >= people.length * 26 && box.h / rem >= 26);
    if (cards) {
      const html = routineCardsHtml(f, people, tick, { touch: o.touch, pop: o.pop, showDone: p.showDone !== false });
      return `<div class="kr-cards cvf-cards${people.length === 1 ? ' is-one' : ''}" style="--kr-n:${people.length}">${html.join('')}</div>`;
    }
    const rows = people.map((m) => personRowHtml(f, m, tick, { touch: o.touch, pop: o.pop }));
    return `<div class="kf-list cvf-rows">${rows.join('')}</div><div class="kf-more"></div>`;
  },
  fit(root, env) {
    root.classList.toggle('cvf-no-stars', onSameScreen(env, 'family.members', (it) => (it.props as Props).showPoints !== false));
    const cards = root.querySelector<HTMLElement>('.cvf-cards');
    if (cards) return fitRoutineCards(cards);
    const list = root.querySelector<HTMLElement>('.cvf-rows');
    // the "next routine" pills, then the bars, then people from the end (one always stays)
    fitList(root, list, '.kf-row', () => (list ? visible(list, '.kf-row .k-chore, .kf-row .kf-next').pop() ?? visible(list, '.kf-row .k-progress').pop() : null));
  },
});

// ------------------------------------------------------------------------------------------------ points
const points = familyCard({
  cls: 'cvf-points',
  topics: [],
  html(env) {
    const g = gate(env);
    if (g) return g.html;
    const f = env.family().state!;
    if (f.hidden || f.private) return privateNote();
    if (!f.showPoints) return note('⭐', ctx.t('cvPointsOff'));
    const p = env.item().props as Props;
    const list = membersOf(f, p.memberIds).filter((m) => m.kid && m.points !== null).sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    if (!list.length) return emptyStateHtml(f, 'is-small');
    let rank = 0, last = -1;
    const rows = list.map((m, i) => {
      if (m.points !== last) rank = i;
      last = m.points ?? 0;
      return `<div class="cvf-rank${rank === 0 ? ' is-first' : ''}" style="${memberStyle(m.color)}"><span class="cvf-place">${rank + 1}</span>${avatar(m)}<span class="k-name">${esc(m.name)}</span>${starsHtml(f, m)}</div>`;
    });
    return `<div class="kf-list cvf-board" style="--cvf-n:${rows.length}">${rows.join('')}</div><div class="kf-more"></div>`;
  },
  fit(root) {
    fitRowsOf(root, root.querySelector<HTMLElement>('.cvf-board'), '.cvf-rank');
  },
  // a box taller than any named size and wide enough: a tile per child side by side (the place, a big face, the stars)
  shape(root, b, env) {
    const f = env.family().state;
    const n = f && !f.hidden && !f.private && f.showPoints ? membersOf(f, (env.item().props as Props).memberIds).filter((m) => m.kid && m.points !== null).length : 0;
    const [w, h] = onScreen(root, b);
    root.classList.toggle('is-tiles', n > 0 && h >= 44 && w >= n * 22);
  },
});

// ------------------------------------------------------------------------------------------------ rewards
const rewards = familyCard({
  cls: 'cvf-rewards',
  topics: [],
  html(env) {
    const g = gate(env);
    if (g) return g.html;
    const f = env.family().state!;
    if (f.hidden || f.private) return privateNote();
    if (!f.showPoints) return note('⭐', ctx.t('cvPointsOff'));
    const max = Math.min(6, Math.max(1, Number((env.item().props as Props).max) || 3));
    const rows = rewardRowsHtml(f, max);
    if (!rows.length) return note('🎁', ctx.t('cvNoRewards'));
    return `<div class="kf-list" style="--cvf-n:${rows.length}">${rows.join('')}</div>`;
  },
  fit(root) {
    fitRowsOf(root, root.querySelector<HTMLElement>('.kf-list'), '.kf-reward');
  },
  // a box taller than any named size and wide enough: a tile per reward side by side (a big face, the reward over
  // two lines, a thick bar)
  shape(root, b, env) {
    const f = env.family().state;
    const n = f?.nextReward ? Math.min(Math.min(6, Math.max(1, Number((env.item().props as Props).max) || 3)), Object.keys(f.nextReward).length) : 0;
    const [w, h] = onScreen(root, b);
    root.classList.toggle('is-tiles', n > 0 && h >= 44 && w >= n * 24);
  },
});

// ------------------------------------------------------------------------------------------------ chores
/** Today's routines of everyone (or the people picked) in one list: what is left first, a face on each. */
const chores = familyCard({
  cls: 'cvf-chores',
  topics: [],
  taps: true,
  html(env, _box, o) {
    const g = gate(env);
    if (g) return g.html;
    const f = env.family().state!;
    if (f.hidden) return emptyStateHtml(f, 'is-small');
    const p = env.item().props as Props;
    const people = membersOf(f, p.memberIds);
    const byId = new Map(people.map((m) => [m.id, m]));
    const mine = f.chores.filter((c) => byId.has(c.memberId) && (p.showDone !== false || !c.done));
    if (!mine.length) return emptyStateHtml(f, 'is-small');
    const sorted = [...mine.filter((c) => !c.done), ...mine.filter((c) => c.done)];
    // several people's chores: whose each one is, by name beside it (the face alone does not say it to everyone)
    const named = new Set(mine.map((c) => c.memberId)).size > 1;
    const rows = sorted.map((c) => {
      const m = byId.get(c.memberId)!;
      return `<div class="cvf-chore" style="${memberStyle(m.color)}">${avatar(m)}${choreHtml(c, f, { touch: o.touch, pop: o.pop, by: named ? m.name : undefined })}</div>`;
    });
    return `<div class="kf-list">${rows.join('')}</div><div class="kf-more"></div>`;
  },
  fit(root) {
    fitList(root, root.querySelector<HTMLElement>('.kf-list'), '.cvf-chore');
  },
  // a box wider than the named sizes: the list in two or three columns (about 40rem each)
  shape(root, b) {
    const cols = root.dataset.room !== undefined ? Math.max(1, Math.min(3, Math.floor(onScreen(root, b)[0] / 40))) : 1;
    root.style.setProperty('--cvf-cols', String(cols));
    root.classList.toggle('is-cols', cols > 1);
  },
});

// ------------------------------------------------------------------------------------------------ meals
/** The week's meals the server sent, or null when the menus are off (the kids layouts' rule). */
function mealsOf(env: AdapterEnv): FamilyDisplayState['meals'] {
  const f = env.family().state;
  return f?.meals && env.cfg().family?.mealsEnabled !== false && f.meals.slots.length ? f.meals : null;
}

const mealsToday = familyCard({
  cls: 'cvf-meals',
  topics: [],
  minute: true,
  html(env) {
    if (!env.cfg().family?.enabled) return note('🍽️', ctx.t('cvFamilyOff'));
    if (!env.family().state) return '';
    const meals = mealsOf(env);
    if (!meals) return note('🍽️', ctx.t('kidsMealsOff'));
    const rows = mealRowsHtml(meals, env.now().dayKey);
    return rows.length ? `<div class="kf-list" style="--cvf-n:${rows.length}">${rows.join('')}</div>` : note('🍽️', ctx.t('kidsNoMealsDay'));
  },
  fit(root) {
    fitRowsOf(root, root.querySelector<HTMLElement>('.kf-list'), '.kf-meal');
  },
  // a box taller than any named size and wide enough: a tile per meal side by side, the dish over a few lines
  shape(root, b, env) {
    const meals = mealsOf(env);
    const day = meals?.days.find((d) => d.date === env.now().dayKey);
    const n = meals && day ? meals.slots.filter((x) => day.meals[x]).length : 0;
    const [w, h] = onScreen(root, b);
    root.classList.toggle('is-tiles', n > 0 && h >= 30 && w >= n * 24);
    // a long low box past the named sizes: the meals side by side
    root.classList.toggle('is-row', n > 1 && root.dataset.room !== undefined && !isLine(root) && h < 30 && w >= n * 30);
  },
});

/**
 * The week (7 days) or the next 3 to 6 days of it (fewer when the card is small); a column per day in a wide card, a
 * row per day in a tall one.
 */
const mealsWeek = familyCard({
  cls: 'cvf-week',
  topics: [],
  minute: true,
  html(env, box) {
    if (!env.cfg().family?.enabled) return note('🍽️', ctx.t('cvFamilyOff'));
    if (!env.family().state) return '';
    const meals = mealsOf(env);
    if (!meals) return note('🍽️', ctx.t('kidsMealsOff'));
    const today = env.now().dayKey;
    // a narrow box (three cells or so): a list of days, each with its meals on lines of their own
    if (box && box.w / box.rem < 46) {
      const from = Math.max(0, meals.days.findIndex((d) => d.date >= today));
      return mealsListHtml(meals, today, meals.days.slice(from));
    }
    const rows = !!box && box.h > box.w;
    // as many days as asked for, and as fit (a day column needs about 9rem, a day row about 4.4rem), from today on
    let n = Math.min(7, Math.max(3, Number((env.item().props as Props).days) || 7));
    if (box) n = Math.max(1, Math.min(n, Math.floor(rows ? (box.h / box.rem - 3.6) / 4.4 : (box.w / box.rem - 8.4) / 9)));
    let days = meals.days;
    if (n < days.length) {
      const from = Math.max(0, days.findIndex((d) => d.date >= today));
      const start = Math.min(from, days.length - n);
      days = days.slice(start, start + n);
    }
    return mealsGridHtml(meals, today, rows, days);
  },
  fit(root) {
    fitList(root, root.querySelector<HTMLElement>('.cvf-mlist'), '.cvf-mday');
  },
});

/** The week's meals as a list of days from today (a narrow card): the day, then a line per meal. Text through esc(). */
function mealsListHtml(meals: NonNullable<FamilyDisplayState['meals']>, today: string, days: NonNullable<FamilyDisplayState['meals']>['days']): string {
  const { t, lang } = ctx;
  const html = days.map((day) => {
    const lines = meals.slots.filter((s) => day.meals[s]).map((s) => `<div class="cvf-mline"><span class="cvf-mline-em">${MEAL_EMOJI[s]}</span><span class="cvf-mline-t">${esc(day.meals[s]!)}</span></div>`);
    const head = `<div class="cvf-mday-h"><span class="km-wd">${esc(day.date === today ? t('today') : weekdayName(lang, day.date, 'long').replace(/-feira$/i, ''))}</span><span class="km-dn">${Number(day.date.slice(8, 10))}</span></div>`;
    return `<div class="cvf-mday${day.date === today ? ' is-today' : ''}">${head}${lines.join('') || `<div class="cvf-mline is-empty">${esc(t('kidsNoMeal'))}</div>`}</div>`;
  });
  return `<div class="kf-list cvf-mlist">${html.join('')}</div><div class="kf-more"></div>`;
}

// ------------------------------------------------------------------------------------------------ birthdays
/** Upcoming birthdays from the screen's events (today first), with "Hoy", "Mañana", "En 5 días" or the date. */
function birthdays(): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let sig = '';
  const render = () => {
    const today = env.now().dayKey;
    const max = Math.min(8, Math.max(1, Number((env.item().props as Props).max) || 5));
    const seen = new Set<string>();
    const list = env.events()
      .filter((e) => isBirthday(e) && !e.ev.busy && e.lastKey >= today)
      .sort((a, b) => a.startKey.localeCompare(b.startKey) || a.title.localeCompare(b.title))
      .filter((e) => {
        const k = `${e.title}|${e.startKey}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, max);
    const { t, lang } = ctx;
    const when = (key: string) => {
      const d = Math.max(0, diffDays(today, key));
      if (d === 0) return t('today');
      if (d === 1) return t('tomorrow');
      if (d < 7) return t('inDays', { n: d });
      const u = keyToUTC(key);
      return `${u.getUTCDate()} ${monthName(lang, u.getUTCMonth() + 1, 'short')}`;
    };
    const rows = list.map((e) => ({ id: e.id, today: e.startKey <= today, title: e.title, emoji: e.emoji || '🎂', when: when(e.startKey) }));
    const s = JSON.stringify([rows, lang]);
    if (s === sig) return;
    sig = s;
    root.textContent = '';
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'k-empty is-small';
      const em = document.createElement('span');
      em.className = 'k-empty-em';
      em.textContent = '🎂';
      const b = document.createElement('b');
      b.textContent = t('cvNoBirthdays');
      empty.append(em, b);
      root.appendChild(empty);
      return;
    }
    const ul = document.createElement('div');
    ul.className = 'kf-list';
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = `cvf-bd${r.today ? ' is-today' : ''}`;
      const em = document.createElement('span');
      em.className = 'cvf-bd-em';
      em.textContent = r.emoji;
      const name = document.createElement('span');
      name.className = 'cvf-bd-name';
      name.textContent = r.title;
      const w = document.createElement('span');
      w.className = 'cvf-bd-when';
      w.textContent = r.when;
      row.append(em, name, w);
      ul.appendChild(row);
    }
    const more = document.createElement('div');
    more.className = 'kf-more';
    root.append(ul, more);
    fit();
  };
  // a long low box past the named sizes: the birthdays in two or three columns, read down each one
  const columns = (b: AdapterBox) => {
    const n = root.querySelectorAll('.cvf-bd').length;
    const [w, h] = onScreen(root, b);
    const cols = root.dataset.room !== undefined && !isLine(root) && h < 40 ? Math.max(1, Math.min(3, n, Math.floor(w / 40))) : 1;
    root.classList.toggle('is-cols', cols > 1);
    root.style.setProperty('--cvf-cols', String(cols));
    root.style.setProperty('--cvf-rows', String(Math.ceil(n / cols)));
  };
  let last: AdapterBox | null = null;
  const fit = () => {
    if (last) columns(last);
    fitRowsOf(root, root.querySelector<HTMLElement>('.kf-list'), '.cvf-bd');
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-fam', 'cvf-birthdays');
      render();
    },
    update() {
      sig = '';
      render();
    },
    layout(b) {
      last = b;
      fit();
    },
    tick(t) {
      if (t.dayChanged) render();
    },
    data(topic) {
      if (topic === 'events' || topic === 'config') render();
    },
    destroy() {
      root.textContent = '';
    },
  };
}

// ------------------------------------------------------------------------------------------------ highlights
/** The pills next to the clock of the other layouts: next event, happening now, check-in/out, birthdays. */
function highlights(): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let box: HTMLElement;
  let hl: Highlights | null = null;
  let max = 0;
  const render = () => hl?.render(env.events(), env.now());
  const build = (n: number) => {
    if (n === max && hl) return;
    max = n;
    box.textContent = '';
    box.className = '';
    hl = new Highlights(box, { cfg: env.cfg, max: n });
    render();
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-hl');
      box = document.createElement('div');
      root.appendChild(box);
      build(4);
    },
    update: () => render(),
    layout(b) {
      // pills of about 30rem side by side in a wide card, two in a small one
      const wide = b.w / b.rem;
      // one fine row high: one line of pills, as many as about 24rem each gives
      if (isLine(root)) {
        root.classList.add('is-row');
        return build(Math.min(4, Math.max(1, Math.floor(onScreen(root, b)[0] / 24))));
      }
      root.classList.toggle('is-row', wide >= 60);
      // a box taller than the named sizes: a pill a line, as many as its height holds (up to six)
      const tall = root.dataset.room !== undefined ? Math.min(6, Math.floor(root.getBoundingClientRect().height / b.rem / 7)) : 0;
      build(wide >= 60 ? Math.min(4, Math.max(2, Math.floor(wide / 30))) : Math.max(tall, b.h / b.rem >= 16 ? 3 : 2));
    },
    tick(t) {
      if (t.minuteChanged) render();
    },
    data(topic) {
      if (topic === 'events' || topic === 'config') render();
    },
    empty: () => !hl || hl.count === 0,
    destroy() {
      root.textContent = '';
    },
  };
}

// ------------------------------------------------------------------------------------------------ announcement
/** The newest announcement on screen (instant ones, from the admin or a webhook); the card is hidden when none. */
function announcement(): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let sig = '';
  let none = true;
  const EMOJI: Record<string, string> = { info: '🔔', success: '✅', warning: '⚠️', urgent: '🚨' };
  const render = () => {
    const a = env.announcement();
    none = !a;
    const s = a ? JSON.stringify([a.id, a.title, a.body, a.emoji, a.style]) : '';
    if (s === sig) return;
    sig = s;
    root.textContent = '';
    root.className = root.className.replace(/\bcvf-an-\w+/g, '').trim();
    if (!a) return;
    root.classList.add(`cvf-an-${a.style}`);
    const em = document.createElement('span');
    em.className = 'cvf-an-em';
    em.textContent = a.emoji || EMOJI[a.style] || EMOJI.info;
    const txt = document.createElement('div');
    txt.className = 'cvf-an-txt';
    let title = (a.title || '').trim();
    if (a.emoji && title.endsWith(a.emoji)) title = title.slice(0, -a.emoji.length).trim();
    else if (a.emoji && title.startsWith(a.emoji)) title = title.slice(a.emoji.length).trim();
    if (title) {
      const b = document.createElement('b');
      b.textContent = title;
      txt.appendChild(b);
    }
    if (a.body) {
      const p = document.createElement('span');
      p.textContent = a.body;
      txt.appendChild(p);
    }
    root.append(em, txt);
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-fam', 'cvf-an');
      render();
    },
    update() {
      sig = '';
      render();
    },
    data(topic) {
      if (topic === 'announcements' || topic === 'config') render();
    },
    empty: () => none,
    destroy() {
      root.textContent = '';
    },
  };
}

export const FAMILY_ADAPTERS: Record<string, () => CanvasAdapter> = {
  'family.members': members,
  'family.routines': routines,
  'family.points': points,
  'family.rewards': rewards,
  'family.chores': chores,
  'meals.today': mealsToday,
  'meals.week': mealsWeek,
  birthdays,
  highlights,
  announcement,
};
