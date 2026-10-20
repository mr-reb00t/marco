// "Sonando ahora bajo el reloj" (screen.nowPlaying, issue #18): one line under the clock of the usual designs with what
// a linked Spotify account plays, drawn as a pill like the highlights above it (a long title slides, marquee.ts). It
// vanishes when nothing plays, and Personalizado screens never show it (they have the Sonando ahora card).
import type { DisplayConfig } from '../../shared/types';
import { HA_ICON } from './ha/haui';
import type { NowPlayingSource } from '../nowPlayingFeed';

export class NowPlayingLine {
  private shown = '';

  constructor(private root: HTMLElement, private feed: NowPlayingSource) {
    root.classList.add('highlights', 'np-line');
  }

  /** The account the line follows on this screen ('' = off; `canvas`: the screen is a Personalizado one). */
  static account(cfg: DisplayConfig | null | undefined, canvas: boolean): string {
    if (!cfg || canvas) return '';
    return typeof cfg.screen?.nowPlaying === 'string' ? cfg.screen.nowPlaying : '';
  }

  /** Draw what plays now (or nothing). Returns true when the line changed (the caller measures the titles again). */
  render(cfg: DisplayConfig | null | undefined, canvas: boolean): boolean {
    const acct = NowPlayingLine.account(cfg, canvas);
    const d = acct ? this.feed.get(acct) : null;
    const key = d ? `${d.title}\n${d.artist}` : '';
    if (key === this.shown) return false;
    this.shown = key;
    this.root.textContent = '';
    if (!d) {
      this.root.style.display = 'none';
      return true;
    }
    const pill = document.createElement('div');
    pill.className = 'hl-pill np-pill';
    const ico = document.createElement('span');
    ico.className = 'hl-lead np-ico';
    ico.innerHTML = HA_ICON.music;
    const tt = document.createElement('span');
    tt.className = 'hl-tt';
    tt.textContent = d.artist ? `${d.title} · ${d.artist}` : d.title;
    // Spotify's terms: what plays is credited to Spotify
    const src = document.createElement('span');
    src.className = 'np-src';
    src.textContent = 'Spotify';
    pill.append(ico, tt, src);
    this.root.appendChild(pill);
    this.root.style.display = '';
    return true;
  }
}
