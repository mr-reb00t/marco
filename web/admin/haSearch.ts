// The search of the Home Assistant entity pickers (components/HaEntityPicker.tsx): plain TypeScript so the tests
// can run it.
import type { HaEntity } from '../shared/types';

/**
 * Words for each domain in the six admin languages, so "luz" or "persiana" finds lights or covers by kind. The search
 * matches substrings, so a word that hides another language's word stays out ("żaluzja" holds "luz").
 */
export const DOMAIN_WORDS: Record<string, string> = {
  light: 'luz luces lámpara light lights lamp luzes licht lamp lys lampe światło lampa oświetlenie',
  switch: 'interruptor enchufe switch plug tomada schakelaar stekker kontakt stik przełącznik gniazdko',
  input_boolean: 'interruptor switch toggle',
  climate: 'clima calefacción aire termostato climate heating thermostat aquecimento klimaat verwarming klima varme klimatyzacja ogrzewanie',
  cover: 'persiana estor cortina cover blind shutter estore rolluik gordijn rullegardin persienne roleta zasłona',
  sensor: 'sensor', binary_sensor: 'sensor',
  media_player: 'multimedia altavoz tele media speaker tv coluna muziek højttaler głośnik telewizor',
  camera: 'cámara camera câmara kamera',
  fan: 'ventilador fan ventoinha ventilator blæser wentylator',
  scene: 'escena scene cena scène scena', script: 'script skrypt', button: 'botón button botão knop knap przycisk',
  lock: 'cerradura lock fechadura slot lås zamek', vacuum: 'aspirador robot vacuum stofzuiger støvsuger odkurzacz',
  valve: 'válvula valve klep ventil zawór', select: 'selector select wybór', input_select: 'selector select wybór',
  number: 'número number liczba', input_number: 'número number liczba', weather: 'tiempo weather tempo weer vejr pogoda',
  person: 'persona person pessoa persoon osoba', update: 'actualización update atualização aktualizacja',
};
const fold = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');

/** An entity matches a search: every word in its name, id, area or domain words, ignoring case and accents. */
export function haEntityMatches(e: HaEntity, q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const domain = e.domain || e.entity_id.split('.')[0];
  const hay = fold([e.name, e.entity_id, e.entity_id.replace(/[._]/g, ' '), e.area ?? '', domain, DOMAIN_WORDS[domain] ?? ''].join(' '));
  return words.every((w) => hay.includes(w));
}

/**
 * The entities that match a search, sorted for the picker: by area (the ones with no area last, under `other`), by
 * name inside an area. When Home Assistant gives no areas at all (a token of a user who is not an administrator), by
 * domain instead.
 */
export function haEntityGroups(list: readonly HaEntity[], q: string, other: string): { e: HaEntity; group: string }[] {
  const all = list.filter((e) => haEntityMatches(e, q));
  const areas = all.some((e) => e.area);
  const groupOf = (e: HaEntity) => (areas ? e.area || other : e.domain || e.entity_id.split('.')[0]);
  return all
    .map((e) => ({ e, group: groupOf(e) }))
    .sort((a, b) => {
      if (a.group !== b.group) return a.group === other ? 1 : b.group === other ? -1 : a.group.localeCompare(b.group);
      return a.e.name.localeCompare(b.e.name);
    });
}
