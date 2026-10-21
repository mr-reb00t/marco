// Types for the parts of familyAccessCore.js the browser uses (admin Accesos de la familia, the phone dashboard).
import type { FamilyAccessPerms } from '../../web/shared/types';

export const ACCESS_PERMS: readonly (keyof Omit<FamilyAccessPerms, 'messageScreens' | 'nightScreens'>)[];
export const MAX_PEOPLE: number;
export const MAX_DEVICES_PER_PERSON: number;
export const NAME_MAX: number;
export const MESSAGE_MAX: number;
export const TODO_TEXT_MAX: number;
export const EVENT_TITLE_MAX: number;
export const MESSAGE_DURATIONS: readonly number[];
export const DEFAULT_MESSAGE_SECONDS: number;
export const CODE_TTL_MS: number;
export const CODE_LENGTH: number;
export const EVENT_DAYS_BACK: number;
export const EVENT_DAYS_AHEAD: number;
export const LINK_TOKEN_RE: RegExp;
export const DEVICE_TOKEN_RE: RegExp;
export const PERSON_ID_RE: RegExp;
export const DEVICE_ID_RE: RegExp;
export const MEMBER_PATH: string;
export function cleanLine(v: unknown): string;
export function emptyPerms(): FamilyAccessPerms;
export function normalizeAccessCode(v: unknown): string | null;
export function deviceLabel(userAgent: string): string;
