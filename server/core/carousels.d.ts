// Types for carousels.js (imported by web/shared/carousels.ts, so the admin and the display share the server rules).
import type { CarouselBlock, Carousel, CarouselDots, CarouselSpeed, CarouselStep, CarouselTransition, PrivacyRule } from '../../web/shared/types';

export declare const CAROUSEL_PREFIX: string;
export declare const MAX_CAROUSELS: number;
export declare const MAX_CAROUSEL_STEPS: number;
export declare const MIN_STEP_SEC: number;
export declare const MAX_STEP_SEC: number;
export declare const DEFAULT_STEP_SEC: number;
export declare const CAROUSEL_TRANSITIONS: readonly CarouselTransition[];
export declare const CAROUSEL_RANDOM_POOL: readonly Exclude<CarouselTransition, 'random' | 'none'>[];
export declare const CAROUSEL_SPEEDS: Readonly<Record<CarouselSpeed, number>>;
export declare const DEFAULT_TRANSITION: CarouselTransition;
export declare const DEFAULT_SPEED: CarouselSpeed;
export declare function speedOf(v: unknown): CarouselSpeed;
export declare const CAROUSEL_DOTS: readonly CarouselDots[];
export declare const DEFAULT_DOTS: CarouselDots;
export declare function dotsOf(v: unknown): CarouselDots;

interface CfgLike {
  screens: { id: string; slug: string; name: string }[];
  defaultScreen?: string;
  datetime?: { timezone: string };
  carousels?: { items: Carousel[] };
}

export interface CarouselSlot {
  index: number;
  screenId: string;
  startsAt: number;
  endsAt: number;
  cycleMs: number;
}

export interface CarouselPhase {
  mode: 'rotate' | 'off' | 'night' | 'paused';
  screenId: string;
  index: number;
  endsAt: number | null;
  inSchedule: boolean;
}

export interface PhaseInput {
  enabled?: boolean;
  nightRotate?: boolean;
  offScreenId?: string | null;
  schedule?: PrivacyRule[];
  steps: CarouselStep[];
}

export declare function isCarouselId(id: unknown): boolean;
export declare function carouselList(cfg: CfgLike | null | undefined): Carousel[];
export declare function findCarousel(cfg: CfgLike, key: string): Carousel | null;
export declare function carouselSteps(cfg: CfgLike, c: Carousel): CarouselStep[];
export declare function offScreenOf(cfg: CfgLike, c: Carousel): string;
export declare function carouselMembers(cfg: CfgLike, c: Carousel): string[];
export declare function emptyCarouselScreen(cfg: CfgLike, c: Carousel): unknown;
export declare function carouselBlock(cfg: CfgLike, c: Carousel): CarouselBlock;
export declare function cycleMs(steps: CarouselStep[]): number;
export declare function carouselSlot(steps: CarouselStep[], nowMs: number): CarouselSlot | null;
export declare function carouselPhase(block: PhaseInput, nowMs: number, opts?: { tz?: string; night?: boolean; offset?: number }): CarouselPhase;
export declare function carouselScreenNow(cfg: CfgLike, c: Carousel, nowMs?: number): string;
export declare function isTargetId(cfg: CfgLike, id: unknown): boolean;
export declare function targetInfo(cfg: CfgLike, id: string): { id: string; kind: 'screen' | 'carousel'; slug: string; name: string } | null;
export declare function targetMembers(cfg: CfgLike, id: string): string[];
export declare function reachableScreens(cfg: CfgLike, ids: string[]): string[];
export declare function readableScreens(cfg: CfgLike, boundId: string): string[];
export declare function pruneCarousels(items: Carousel[], screenIds: string[]): Carousel[];
