// Types for weatherPlaces.js (weather of other places, #11), used by the admin and the display.
import type { WeatherPlace } from '../../web/shared/types';

export const MAX_SCREEN_WEATHER_PLACES: number;
export const MAX_WEATHER_PLACES: number;
export const CITIES_MIN: number;
export const CITIES_MAX: number;
export const WEATHER_PLACE_KINDS: string[];
export type KeyedPlace = WeatherPlace & { key: string; home: boolean };
export function placeKey(p: { lat: number; lon: number }): string;
export function homePlace(weather: { locationName?: string; lat?: number; lon?: number } | null | undefined): WeatherPlace;
export function cleanPlace(c: { err: (path: string, msg: string) => void }, path: string, v: unknown): WeatherPlace | null;
export function cardPlaces(items: { kind: string; props?: Record<string, unknown>; hidden?: boolean }[] | null | undefined): WeatherPlace[];
export function weatherPlacesOf(
  weather: { locationName?: string; lat?: number; lon?: number; place?: WeatherPlace | null } | null | undefined,
  items?: { kind: string; props?: Record<string, unknown>; hidden?: boolean }[] | null,
): KeyedPlace[];
export function screenWeatherPlaces(cfg: unknown, screen: unknown): KeyedPlace[];
export function countScreenPlaces(cfg: unknown, screen: unknown): number;
export function configWeatherPlaces(cfg: unknown): KeyedPlace[];
export function placeLabel(p: { name?: string } | null | undefined): string;
export function previewPlacesOf(body: unknown): WeatherPlace[] | null;
