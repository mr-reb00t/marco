// Personalizado "Sonando ahora" card (kind 'nowplaying', issue #18): what a linked Spotify account plays now, with
// the cover, the title, the artist and a thin bar that moves on by itself between answers. Nothing playing (paused,
// stopped, an ad): the card is not drawn on the TV; the admin's preview shows a calm note instead, so it can be
// placed. It looks like the Home Assistant media card (the cv-ha-media rules of styles-ha.css), without controls:
// Marco only reads what plays. The data comes from nowPlayingFeed.ts; the cover is a blob of this server's answer.
import type { DisplayCanvasItem } from '../../../shared/types';
import { ctx } from '../../ctx';
import { isPreview } from '../../identity';
import { HA_ICON } from '../ha/haui';
import { bigType, typeCap } from './clock';
import { el, miniLine, squeeze } from './ha';
import type { AdapterBox, AdapterEnv, CanvasAdapter } from './types';

/** m:ss (h:mm:ss past an hour) of a number of seconds. */
export const clockText = (sec: number): string => {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

function musicIcon(cls: string): HTMLElement {
  const e = el('span', cls);
  const svg = HA_ICON.music;
  e.innerHTML = svg;
  return e;
}

export function nowPlayingAdapter(_item: DisplayCanvasItem): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let last: AdapterBox | null = null;
  let sig = '';
  let bar: { fill: HTMLElement; at: HTMLElement; left: HTMLElement; dur: number } | null = null;

  const account = () => String((env.item().props as Record<string, unknown>).account ?? '');
  const data = () => (account() ? env.nowPlaying.get(account()) : null);

  /** Where the track is now, on the thin bar and the two times beside it. */
  const paint = () => {
    if (!bar) return;
    const t = env.nowPlaying.position(account()) ?? 0;
    bar.fill.style.width = `${bar.dur ? Math.min(100, (t / bar.dur) * 100).toFixed(2) : 0}%`;
    bar.at.textContent = clockText(t);
    bar.left.textContent = `-${clockText(bar.dur - t)}`;
  };

  const render = (force = false) => {
    const p = env.item().props as Record<string, unknown>;
    const d = data();
    const s = JSON.stringify([env.item().v, d?.title, d?.artist, d?.album, d?.art, d?.duration, ctx.lang, last?.size, last?.w, last?.h, root.dataset.mh]);
    if (s === sig && !force) return paint();
    sig = s;
    root.textContent = '';
    bar = null;
    if (!d) {
      // the TV draws nothing (empty()); the preview says why the card is blank
      if (isPreview) root.appendChild(el('span', 'cv-ha-note', ctx.t(account() ? 'npNothing' : 'npChoose')));
      return;
    }
    const line = miniLine(root);
    const art = el('div', 'cv-ha-art');
    const url = p.art !== false && d.art ? env.nowPlaying.art(d.art, () => render(true)) : null;
    if (url) art.style.backgroundImage = `url("${url}")`;
    else art.appendChild(musicIcon('cv-ha-art-ico'));
    const txt = el('div', 'cv-ha-txt');
    txt.append(el('span', 'cv-ha-title', d.title));
    if (d.artist) txt.append(el('span', 'cv-ha-artist cv-sec1', d.artist));
    if (d.album && !line) txt.append(el('span', 'cv-ha-state cv-sec3', d.album));
    if (p.progress !== false && !line && root.dataset.size !== 's' && d.duration) {
      const pg = el('div', 'cv-ha-prog cv-sec2');
      const track = el('span', 'cv-ha-prog-bar');
      const fill = el('i', '');
      track.appendChild(fill);
      const at = el('span', 'cv-ha-prog-t');
      const left = el('span', 'cv-ha-prog-t is-left');
      pg.append(at, track, left);
      txt.append(pg);
      bar = { fill, at, left, dur: d.duration };
    }
    const wrap = el('div', 'cv-ha-player tone-on');
    if (p.art !== false) wrap.append(art);
    wrap.append(txt);
    // where it comes from (Spotify's terms: the track and the cover are credited to Spotify): a small last line, or
    // at the end of the one line
    const src = el('span', `cv-np-src${line ? ' is-inline' : ''}`, 'Spotify');
    if (line) wrap.append(src);
    else txt.append(src);
    root.appendChild(wrap);
    paint();
    fit();
  };

  const fit = () => {
    if (!last) return;
    const box = last;
    const sc = Number(env.item().style?.scale) || 1;
    if (miniLine(root)) {
      root.classList.remove('is-stack');
      bigType(root, box, 4.6, sc, 0, 1.2);
    } else {
      // a box as high as it is wide: the cover on top, the words under it, both centred
      const stack = box.zone === 'main' && box.h >= box.w * 0.95;
      root.classList.toggle('is-stack', stack);
      if (stack) bigType(root, box, 18, sc, 22, typeCap(root));
      else bigType(root, box, box.size === 's' ? 7 : 9, sc, box.size === 's' ? 22 : 34, typeCap(root));
    }
    squeeze(root);
  };

  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-ha', 'cv-ha-media', 'cv-np');
      render(true);
    },
    update: () => render(true),
    layout(box) {
      last = box;
      root.dataset.size = box.size;
      render(true);
    },
    tick() {
      // the bar moves on each second while the card shows (the answer said where it was, the clock does the rest)
      if (bar) paint();
    },
    data(topic) {
      if (topic === 'nowplaying' || topic === 'config') render();
    },
    empty: () => !isPreview && !data(),
    destroy() {
      root.textContent = '';
      bar = null;
    },
  };
}

export const NOW_PLAYING_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  nowplaying: (item) => nowPlayingAdapter(item),
};
