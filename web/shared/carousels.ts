// Carousels for the admin and the display: the server's own rules (server/core/carousels.js, typed by its .d.ts),
// so the slot clock, the schedule and the night hold are computed the same way everywhere.
export {
  CAROUSEL_PREFIX, MAX_CAROUSELS, MAX_CAROUSEL_STEPS, MIN_STEP_SEC, MAX_STEP_SEC, DEFAULT_STEP_SEC, CAROUSEL_TRANSITIONS,
  CAROUSEL_RANDOM_POOL, CAROUSEL_SPEEDS, DEFAULT_TRANSITION, DEFAULT_SPEED, speedOf,
  CAROUSEL_DOTS, DEFAULT_DOTS, dotsOf,
  isCarouselId, carouselList, carouselSteps, carouselMembers, carouselBlock, offScreenOf, cycleMs, carouselSlot,
  carouselPhase, pruneCarousels, targetInfo, isTargetId,
} from '../../server/core/carousels.js';
export type { CarouselPhase, CarouselSlot, PhaseInput } from '../../server/core/carousels.js';
