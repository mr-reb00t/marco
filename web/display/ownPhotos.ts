// The photo lists of the Personalizado photo cards that have photos of their own (#41, props.photoSource with mode
// 'own'): GET /api/photos?for=<card id>, the server reading that card's saved settings. One list per distinct setting
// (two cards with the same share it, each starting at its own place), asked for when a card needs it and again on the
// screen's own photo refreshes (the hourly tick, a live `photos` event, a special background check). A list that could
// not be had is asked for again on a timer, a minute later and then less and less often (up to every 30 min), never
// at once: a card not saved yet in the preview or a display offline would otherwise ask without end.
// A card on the screen's photos ('screen') keeps nothing here, except while the sidebar's photo has photos of its own:
// the screen's list (state.photos) is then the sidebar's, and those cards get the Fondo's list here (no ?for=).
import type { DisplayPhotoSource, PhotosResponse } from '../shared/types';
import { api } from './api';

interface Entry {
  key: string;
  /** the card that asks for the list (the first that wanted it; any card with the same settings gets the same); '' for the Fondo's list */
  forId: string;
  screen: string;
  special: boolean;
  topic: string;
  users: Set<string>;
  resp: PhotosResponse | null;
  /** when the last answer came (0: none yet) */
  at: number;
  /** when a card last asked for the next batch */
  moreAt: number;
  /** the photo a card showed last (the next batch goes on after it) */
  last: string;
  inflight: boolean;
  /** the server does not know the card (an older server, a card not saved yet) or did not answer: the screen's photos */
  fallback: boolean;
  /** failed requests in a row, and the timer that asks again */
  fails: number;
  retry: ReturnType<typeof setTimeout> | null;
  /** when the entry was last used (pruning) */
  used: number;
}

export interface OwnPhotosDeps {
  /** the screen on display ('' before the first config) */
  screen(): string;
  demo(): boolean;
  /** the demo's photos for a topic (mock.ts mockPhotos) */
  mock(topic: string): PhotosResponse;
  /** the screen's own photos, for a card whose list could not be had */
  fallback(): PhotosResponse | null;
  /**
   * The Fondo of the screen on display (its raw screen.background) while the sidebar's photo has photos of its own,
   * else null: the screen's list then is the Fondo's and a card on the screen's photos needs none here.
   */
  fondo(): { stockTopic: string; special?: boolean } | null;
  /** a list came: the cards look again (canvasView.onData('photos')) */
  changed(): void;
}

const MAX_ENTRIES = 8;
const MAX_AGE_MS = 60 * 60_000;
const MORE_EVERY_MS = 30_000;
const RETRY_MS = 60_000;
const RETRY_MAX_MS = 30 * 60_000;

export class OwnPhotos {
  private entries = new Map<string, Entry>();
  private byItem = new Map<string, string>();
  /** cards in 'own' mode whose list could not be had and that show the Fondo's list meanwhile (the sidebar is own) */
  private fondoBy = new Map<string, string>();
  constructor(private deps: OwnPhotosDeps) {}

  /** How many lists are kept (tests and the demo). */
  get size(): number {
    return this.entries.size;
  }

  private keyOf(b: DisplayPhotoSource): string {
    return `${this.deps.screen()}|${JSON.stringify([b.source, b.stockTopic, b.order, b.immich?.albumIds ?? [], !!b.immich?.favoritesOnly, b.rulesSig ?? ''])}`;
  }

  private fondoKey(): string {
    return `${this.deps.screen()}|fondo`;
  }

  private entry(key: string, forId: string, special: boolean, topic: string): Entry {
    let e = this.entries.get(key);
    if (!e) {
      e = { key, forId, screen: this.deps.screen(), special, topic, users: new Set(), resp: null, at: 0, moreAt: 0, last: '', inflight: false, fallback: false, fails: 0, retry: null, used: Date.now() };
      this.entries.set(key, e);
      this.prune();
    }
    e.used = Date.now();
    return e;
  }

  /** Ask for the list when it has none and is not waiting for a retry, or when it is old. */
  private due(e: Entry): void {
    if (e.resp ? Date.now() - e.at > MAX_AGE_MS : !e.fallback) this.load(e);
  }

  /**
   * Card `itemId` shows the photos of `block` (mode 'own'), or with null the screen's photos: its list, or null while
   * it loads. With null and the sidebar not on photos of its own, the screen's list and nothing kept.
   */
  want(itemId: string, block: DisplayPhotoSource | null): PhotosResponse | null {
    const fondo = block ? null : this.deps.fondo();
    if (!block && !fondo) {
      this.release(itemId);
      return this.deps.fallback();
    }
    const key = block ? this.keyOf(block) : this.fondoKey();
    const was = this.byItem.get(itemId);
    if (was && was !== key) this.release(itemId);
    const e = block ? this.entry(key, itemId, !!block.special, block.stockTopic) : this.entry(key, '', !!fondo!.special, fondo!.stockTopic);
    e.users.add(itemId);
    this.byItem.set(itemId, key);
    this.due(e);
    return this.get(itemId);
  }

  /** The card no longer shows photos of its own (or is gone). */
  release(itemId: string): void {
    const key = this.byItem.get(itemId);
    this.byItem.delete(itemId);
    if (key) this.entries.get(key)?.users.delete(itemId);
    const fk = this.fondoBy.get(itemId);
    this.fondoBy.delete(itemId);
    if (fk) this.entries.get(fk)?.users.delete(itemId);
  }

  /** The list of card `itemId`: its own, the screen's when its own could not be had, or null (loading, or not own). */
  get(itemId: string): PhotosResponse | null {
    const key = this.byItem.get(itemId);
    const e = key ? this.entries.get(key) : undefined;
    if (!e) return null;
    if (e.resp) return e.resp;
    if (!e.fallback) return null;
    // could not be had: the Fondo's photos. While the sidebar has photos of its own the screen's list is the
    // sidebar's, so the Fondo's list is kept here for this card too
    const fondo = e.forId ? this.deps.fondo() : null;
    if (!fondo) return this.deps.fallback();
    const fk = this.fondoKey();
    const was = this.fondoBy.get(itemId);
    if (was && was !== fk) this.entries.get(was)?.users.delete(itemId);
    const f = this.entry(fk, '', !!fondo.special, fondo.stockTopic);
    f.users.add(itemId);
    this.fondoBy.set(itemId, fk);
    this.due(f);
    return f.resp ?? (f.fallback ? this.deps.fallback() : null);
  }

  /**
   * Card `itemId` showed its whole batch: the next one after `after`, at most once every 30 s per list. False when
   * the card keeps no list here (the screen's photos: main.ts morePhotos asks then).
   */
  more(itemId: string, after: string): boolean {
    const key = this.byItem.get(itemId);
    let e = key ? this.entries.get(key) : undefined;
    if (!e) return false;
    // its own list could not be had: the list it shows meanwhile goes on (the Fondo's here, or the screen's)
    if (!e.resp) {
      const fk = this.fondoBy.get(itemId);
      e = fk ? this.entries.get(fk) : undefined;
      if (!e) return false;
    }
    if (!e.resp || Date.now() - e.moreAt < MORE_EVERY_MS) return true;
    e.moreAt = Date.now();
    e.last = after;
    this.load(e, after);
    return true;
  }

  /** Ask again for every list in use (the screen's own photo refreshes). Nothing when no card has photos of its own. */
  refresh(): void {
    for (const e of this.entries.values()) if (e.users.size) this.load(e, e.last);
  }

  /** Some card in use has special backgrounds of its own (checked again as the screen's are, main.ts checkBgRule). */
  anySpecial(): boolean {
    for (const e of this.entries.values()) if (e.users.size && e.special) return true;
    return false;
  }

  private prune(): void {
    // lists of other screens (a carousel) and lists no card uses any more, the oldest first
    const idle = [...this.entries.entries()].filter(([, e]) => !e.users.size).sort((a, b) => a[1].used - b[1].used);
    while (this.entries.size > MAX_ENTRIES && idle.length) {
      const e = idle.shift()![1];
      if (e.retry) clearTimeout(e.retry);
      this.entries.delete(e.key);
    }
  }

  /** A failed request: asked again a minute later, then twice as long each time up to 30 min, while a card uses it. */
  private retryLater(e: Entry): void {
    if (e.retry) clearTimeout(e.retry);
    const wait = Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** Math.min(10, e.fails - 1));
    e.retry = setTimeout(() => {
      e.retry = null;
      if (this.entries.get(e.key) === e && e.users.size) this.load(e, e.last);
    }, wait);
  }

  private load(e: Entry, after = ''): void {
    if (this.deps.demo()) {
      e.resp = this.deps.mock(e.topic);
      e.at = Date.now();
      return;
    }
    if (e.inflight) return;
    if (e.retry) clearTimeout(e.retry);
    e.retry = null;
    e.inflight = true;
    const screen = e.screen;
    // the card that asks: one that still uses the list
    if (e.forId && !e.users.has(e.forId) && e.users.size) e.forId = e.users.values().next().value!;
    api
      .photos(20, after, undefined, e.forId || undefined)
      .then((r) => {
        e.inflight = false;
        if (screen !== this.deps.screen()) return;
        e.resp = r;
        e.at = Date.now();
        e.fallback = false;
        e.fails = 0;
        this.deps.changed();
      })
      .catch((err) => {
        e.inflight = false;
        if (screen !== this.deps.screen()) return;
        console.warn('[photos]', (err as Error).message);
        e.fails++;
        // with no list yet, asked again later on a timer (never at once: the cards look again below, and asking at
        // each look would never end)
        if (!e.resp) this.retryLater(e);
        // an older server (no ?for=), a card the server does not show, a network error with nothing yet: the
        // screen's photos for now, so the card is not left empty (the cards look again only the first time)
        if (!e.resp && !e.fallback) {
          e.fallback = true;
          e.at = Date.now();
          this.deps.changed();
        }
      });
  }
}
