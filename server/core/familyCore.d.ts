// Types for the parts of familyCore.js the browser uses (admin Familia / Menús, display kids layouts).
import type { ChoreSlot, FamilyChore, FamilyConfig, MealDays, MealSlot, MealsConfig } from '../../web/shared/types';

export const MAX_MEMBERS: number;
export const MAX_CHORES: number;
export const MAX_REWARDS: number;
export const MAX_MEAL_WEEKS: number;
export const MAX_MEAL_TEXT: number;
export const MAX_NOTE: number;
export const MAX_DELTA: number;
export const RETENTION_DAYS: number;
export const CHORE_SLOTS: readonly ChoreSlot[];
export const MEAL_SLOTS: readonly MealSlot[];
export const SLOT_STARTS: Readonly<{ afternoon: string; evening: string }>;
export const PASTELS: readonly string[];
export const KIDS_PRESETS: readonly ('kidsRoutines' | 'kidsFamily' | 'kidsMeals')[];
export function showsFamilyQr(screen: { layout?: { preset?: string }; screen?: { style?: string } } | null | undefined): boolean;
export const FAMILY_KEY_RE: RegExp;
export const WEEK_KEY_RE: RegExp;

export function newId(prefix: string, bytes?: number): string;
export function defaultFamily(): FamilyConfig;
export function defaultScreenFamily(): { memberIds: string[] | null; touch: boolean; showQr: boolean };
export function dayOfWeek(date: string): number;
export function isoWeekKey(date: string): string;
export function weekStartOf(date: string, weekStart?: number): string;
export function slotAt(hhmm: string): Exclude<ChoreSlot, 'any'>;
/** Meals from outside (Mealie): per date, per meal; `photo` is the dinner's recipe photo. */
export type MealOverlay = Record<string, Partial<Record<MealSlot, string>> & { photo?: { id: string; v: string } }>;
export function mealsForDate(meals: MealsConfig, date: string, overlay?: MealOverlay | null): Partial<Record<MealSlot, string>>;
export function mealsOfWeek(meals: MealsConfig, startDate: string, overlay?: MealOverlay | null): { date: string; dow: number; meals: Partial<Record<MealSlot, string>> }[];
export function choresForDay(family: Pick<FamilyConfig, 'members' | 'chores'>, date: string, memberIds?: string[] | null): FamilyChore[];
export function initials(name: string): string;
export type { MealDays };
