// The photo lists of the Personalizado photo cards that have photos of their own (#41, props.photoSource with mode
// 'own'): GET /api/photos?for=<card id>, the server reading that card's saved settings. One list per distinct setting
// (two cards with the same share it, each starting at its own place), asked for when a card needs it and again on the
// screen's own photo refreshes (the hourly tick, a live `photos` event, a special background check), never on a timer
// of its own. A card on the screen's photos ('screen') never comes here.
import type { DisplayPhotoSource, PhotosResponse } from '../shared/types';
import { api } from './api';

interface Entry {
  /** the card that asks for the list (the first that wanted it; any card with the same settings gets the same) */
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
  /** a list came: the cards look again (canvasView.onData('photos')) */
  changed(): void;
}

const MAX_ENTRIES = 8;
const MAX_AGE_MS = 60 * 60_000;
const MORE_EVERY_MS = 30_000;

export class OwnPhotos {
  private entries = new Map<string, Entry>();
  private byItem = new Map<string, string>();
  constructor(private deps: OwnPhotosDeps) {}

  /** How many lists are kept (tests and the demo). */
  get size(): number {
    return this.entries.size;
  }

  private keyOf(b: DisplayPhotoSource): string {
    return `${this.deps.screen()}|${JSON.stringify([b.source, b.stockTopic, b.order, b.immich?.albumIds ?? [], !!b.immich?.favoritesOnly, b.rulesSig ?? ''])}`;
  }

  /** Card `itemId` shows the photos of `block` (mode 'own'): its list, or null while it loads. */
  want(itemId: string, block: DisplayPhotoSource): PhotosResponse | null {
    const key = this.keyOf(block);
    const was = this.byItem.get(itemId);
    if (was && was !== key) this.release(itemId);
    let e = this.entries.get(key);
    if (!e) {
      e = { forId: itemId, screen: this.deps.screen(), special: !!block.special, topic: block.stockTopic, users: new Set(), resp: null, at: 0, moreAt: 0, last: '', inflight: false, fallback: false, used: Date.now() };
      this.entries.set(key, e);
      this.prune();
    }
    e.users.add(itemId);
    e.used = Date.now();
    this.byItem.set(itemId, key);
    if (!e.resp || Date.now() - e.at > MAX_AGE_MS) this.load(e);
    return this.get(itemId);
  }

  /** The card no longer shows photos of its own (or is gone). */
  release(itemId: string): void {
    const key = this.byItem.get(itemId);
    if (!key) return;
    this.byItem.delete(itemId);
    this.entries.get(key)?.users.delete(itemId);
  }

  /** The list of card `itemId`: its own, the screen's when its own could not be had, or null (loading, or not own). */
  get(itemId: string): PhotosResponse | null {
    const key = this.byItem.get(itemId);
    const e = key ? this.entries.get(key) : undefined;
    if (!e) return null;
    if (e.resp) return e.resp;
    return e.fallback ? this.deps.fallback() : null;
  }

  /** Card `itemId` showed its whole batch: the next one after `after`, at most once every 30 s per list. */
  more(itemId: string, after: string): void {
    const key = this.byItem.get(itemId);
    const e = key ? this.entries.get(key) : undefined;
    if (!e || Date.now() - e.moreAt < MORE_EVERY_MS) return;
    e.moreAt = Date.now();
    e.last = after;
    this.load(e, after);
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
    while (this.entries.size > MAX_ENTRIES && idle.length) this.entries.delete(idle.shift()![0]);
  }

  private load(e: Entry, after = ''): void {
    if (this.deps.demo()) {
      e.resp = this.deps.mock(e.topic);
      e.at = Date.now();
      return;
    }
    if (e.inflight) return;
    e.inflight = true;
    const screen = e.screen;
    // the card that asks: one that still uses the list
    if (!e.users.has(e.forId) && e.users.size) e.forId = e.users.values().next().value!;
    api
      .photos(20, after, undefined, e.forId)
      .then((r) => {
        e.inflight = false;
        if (screen !== this.deps.screen()) return;
        e.resp = r;
        e.at = Date.now();
        e.fallback = false;
        this.deps.changed();
      })
      .catch((err) => {
        e.inflight = false;
        console.warn('[photos]', (err as Error).message);
        // an older server (no ?for=), a card the server does not show, a network error with nothing yet: the
        // screen's photos for now, so the card is not left empty
        if (!e.resp) {
          e.fallback = true;
          e.at = Date.now();
          this.deps.changed();
        }
      });
  }
}
