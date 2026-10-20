// "Fondos especiales" (#14): the screen's background.rules, other photos on some days. Each rule is a "when" (an
// event today whose title has a word, a yearly range of days, one day, a birthday) and its photos (gallery files or an
// Immich album). The server checks them in order (server/core/bgRules.js): the first that matches wins.
import { useEffect, useState } from 'preact/hooks';
import type { AdminPhoto, AppConfig, BackgroundRule, BackgroundRuleWhen, ImmichAlbum } from '../../shared/types';
import { api } from '../api';
import { Icon } from '../components/icons';
import { SourcePicker } from '../components/SourcePicker';
import { Button, Callout, Card, Empty, Modal, ReorderButtons, Segmented, Select, TextInput, useReorder } from '../components/ui';
import { has } from '../caps';
import { locale, t } from '../i18n';
import { allSourceOptions, moveItem, uid } from '../util';
import type { SectionProps } from './common';

/** Caps of server/core/bgRules.js. */
export const MAX_BG_RULES = 30;
export const MAX_BG_RULE_PHOTOS = 50;
export const MAX_BG_RULE_TEXT = 60;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad = (n: number) => String(n).padStart(2, '0');

/** A month and a day (MM-DD), as two selects in the order the language writes them. */
function MonthDay({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [m, d] = value.split('-').map(Number);
  const month = m >= 1 && m <= 12 ? m : 1;
  const day = Math.min(d >= 1 ? d : 1, DAYS_IN_MONTH[month - 1]);
  const fmt = new Intl.DateTimeFormat(locale(), { month: 'long', timeZone: 'UTC' });
  const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: fmt.format(new Date(Date.UTC(2024, i, 1))) }));
  const days = Array.from({ length: DAYS_IN_MONTH[month - 1] }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  return (
    <span class="bg-rule__md">
      <Select value={day} options={days} onChange={(v) => onChange(`${pad(month)}-${pad(v)}`)} />
      <Select value={month} options={months} onChange={(v) => onChange(`${pad(v)}-${pad(Math.min(day, DAYS_IN_MONTH[v - 1]))}`)} />
    </span>
  );
}

/** A fresh "when" of `type`, keeping what still fits from the old one. */
function whenOf(type: BackgroundRuleWhen['type'], old: BackgroundRuleWhen): BackgroundRuleWhen {
  const from = old.type === 'range' ? old.from : old.type === 'date' ? old.on : '12-01';
  if (type === 'event') return { type, text: old.type === 'event' ? old.text : '', calendars: old.type === 'event' ? old.calendars : [] };
  if (type === 'range') return { type, from, to: old.type === 'range' ? old.to : from === '12-01' ? '12-31' : from };
  if (type === 'date') return { type, on: from === '12-01' ? '12-25' : from };
  return { type };
}

/** Gallery picker: tap photos to add or take them out (at most 50). Hidden photos are not offered. */
function PhotoPicker({ gallery, value, onClose }: { gallery: AdminPhoto[]; value: string[]; onClose: (files: string[] | null) => void }) {
  const [sel, setSel] = useState<string[]>(value);
  const shown = gallery.filter((p) => !p.hidden || value.includes(p.file));
  const full = sel.length >= MAX_BG_RULE_PHOTOS;
  const toggle = (f: string) => setSel((s) => (s.includes(f) ? s.filter((x) => x !== f) : full ? s : [...s, f]));
  return (
    <Modal
      title={t('Elegir fotos')}
      icon="photos"
      size="lg"
      onClose={() => onClose(null)}
      footer={
        <>
          <span class="muted small bg-pick__count">{t('Elegidas: {count} de {max}', { count: sel.length, max: MAX_BG_RULE_PHOTOS })}</span>
          <Button onClick={() => onClose(null)}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={() => onClose(sel)}>
            {t('Listo')}
          </Button>
        </>
      }
    >
      {shown.length === 0 ? (
        <Empty icon="photos" title={t('No hay fotos en la galería')}>
          <a href="#/photos">{t('Sube fotos en Galería')}</a>
        </Empty>
      ) : (
        <div class="bg-pick" role="group">
          {shown.map((p) => {
            const on = sel.includes(p.file);
            return (
              <button type="button" class={`bg-pick__ph ${on ? 'is-active' : ''} ${p.hidden ? 'is-hidden' : ''}`} aria-pressed={on} title={p.file} disabled={!on && full} onClick={() => toggle(p.file)}>
                <img src={p.thumbUrl ?? p.url} alt="" loading="lazy" />
                {on && (
                  <span class="bg-pick__check">
                    <Icon name="check" size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

export function BackgroundRulesCard({ cfg, set, errors, full }: Pick<SectionProps, 'cfg' | 'set' | 'errors' | 'full'>) {
  const rules = cfg.background.rules ?? [];
  const galleryOn = has('gallery');
  const immichOn = has('immich');
  const [gallery, setGallery] = useState<AdminPhoto[] | null>(null);
  const [albums, setAlbums] = useState<ImmichAlbum[] | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const usesImmich = rules.some((r) => r.photos.source === 'immich');
  useEffect(() => {
    if (galleryOn && gallery === null && rules.length) api.photos().then(setGallery, () => setGallery([]));
  }, [rules.length > 0]);
  useEffect(() => {
    if (immichOn && albums === null && usesImmich) api.immichAlbums().then(setAlbums, () => setAlbums([]));
  }, [usesImmich]);
  const write = (fn: (list: BackgroundRule[]) => BackgroundRule[]) => set((d: AppConfig) => void (d.background.rules = fn(d.background.rules ?? [])));
  const upd = (id: string, fn: (r: BackgroundRule) => void) =>
    write((list) =>
      list.map((r) => {
        if (r.id !== id) return r;
        const x = structuredClone(r);
        fn(x);
        return x;
      })
    );
  const move = (from: number, to: number) => write((list) => moveItem(list, from, to));
  const reorder = useReorder(move);
  if (!galleryOn && !immichOn && !rules.length) return null;
  const add = () =>
    write((list) => [...list, { id: uid('bg'), when: { type: 'event', text: '', calendars: [] }, photos: galleryOn ? { source: 'gallery', files: [] } : { source: 'immich', albumId: '' } }]);
  const sources = allSourceOptions(full).filter((o) => !Array.isArray(cfg.calendar.sourceIds) || cfg.calendar.sourceIds.includes(o.id));
  const byFile = new Map((gallery ?? []).map((p) => [p.file, p]));
  const pickingRule = rules.find((r) => r.id === picking);

  return (
    <Card
      id="bg-rules"
      scope="screen"
      title={t('Fondos especiales')}
      icon="calendar"
      desc={t('Otras fotos en fechas señaladas o cuando hay cierto evento. Gana la primera regla que coincide; si ninguna coincide, se usa el fondo normal.')}
      actions={
        <Button size="sm" icon="plus" disabled={rules.length >= MAX_BG_RULES} onClick={add}>
          {t('Añadir regla')}
        </Button>
      }
    >
      {rules.length === 0 ? (
        <p class="muted small">{t('Por ejemplo, fotos de Navidad del 1 al 31 de diciembre, o de la playa los días con un evento «Vacaciones».')}</p>
      ) : (
        <div class="rule-list">
          {rules.map((r, i) => {
            const w = r.when;
            const ph = r.photos;
            const err = (k: string) => errors[`background.rules.${r.id}.${k}`];
            const files = ph.source === 'gallery' ? ph.files : [];
            return (
              <div key={r.id} class="rule bg-rule" {...(reorder.rowProps(i) as any)}>
                <span class="grip" {...reorder.handleProps(i)}>
                  <Icon name="grip" size={16} />
                </span>
                <span class="rule__n">{i + 1}</span>
                <div class="bg-rule__body">
                  <div class="bg-rule__line">
                    <Select
                      value={w.type}
                      options={[
                        { value: 'event' as const, label: t('Evento de hoy con…') },
                        { value: 'range' as const, label: t('Entre dos fechas') },
                        { value: 'date' as const, label: t('Un solo día') },
                        { value: 'birthday' as const, label: t('Un cumpleaños') },
                      ]}
                      onChange={(v) => upd(r.id, (x) => void (x.when = whenOf(v, x.when)))}
                    />
                    {w.type === 'event' && (
                      <>
                        <TextInput
                          class="bg-rule__text"
                          value={w.text}
                          maxLength={MAX_BG_RULE_TEXT}
                          error={!!err('text')}
                          placeholder={t('Palabra del título, p. ej. Navidad')}
                          onValue={(v) => upd(r.id, (x) => void (x.when.type === 'event' && (x.when.text = v)))}
                        />
                        <SourcePicker
                          compact
                          options={sources}
                          value={w.calendars}
                          allLabel={t('Calendarios de esta pantalla')}
                          onChange={(v) => upd(r.id, (x) => void (x.when.type === 'event' && (x.when.calendars = v)))}
                        />
                      </>
                    )}
                    {w.type === 'range' && (
                      <>
                        <MonthDay value={w.from} onChange={(v) => upd(r.id, (x) => void (x.when.type === 'range' && (x.when.from = v)))} />
                        <span class="muted small">{t('al')}</span>
                        <MonthDay value={w.to} onChange={(v) => upd(r.id, (x) => void (x.when.type === 'range' && (x.when.to = v)))} />
                      </>
                    )}
                    {w.type === 'date' && <MonthDay value={w.on} onChange={(v) => upd(r.id, (x) => void (x.when.type === 'date' && (x.when.on = v)))} />}
                    {w.type === 'birthday' && <span class="muted small">{t('Cuando alguien de Cumpleaños cumple años hoy.')}</span>}
                  </div>
                  <div class="bg-rule__line">
                    {(immichOn || ph.source === 'immich') && galleryOn && (
                      <Segmented
                        size="sm"
                        value={ph.source}
                        options={[
                          { value: 'gallery' as const, label: t('Galería'), icon: 'photos' as const },
                          { value: 'immich' as const, label: 'Immich', icon: 'image' as const },
                        ]}
                        onChange={(v) => upd(r.id, (x) => void (x.photos = v === 'immich' ? { source: 'immich', albumId: '' } : { source: 'gallery', files: [] }))}
                      />
                    )}
                    {ph.source === 'gallery' ? (
                      <>
                        <span class="bg-rule__thumbs">
                          {files.slice(0, 5).map((f) => {
                            const p = byFile.get(f);
                            return p ? <img src={p.thumbUrl ?? p.url} alt="" title={f} loading="lazy" /> : null;
                          })}
                          {files.length > 5 && <span class="muted small">+{files.length - 5}</span>}
                        </span>
                        <Button size="sm" variant={err('photos') ? 'danger' : 'default'} icon="photos" disabled={!galleryOn} onClick={() => setPicking(r.id)}>
                          {files.length ? t('{n} fotos', { n: files.length }) : t('Elegir fotos')}
                        </Button>
                      </>
                    ) : immichOn ? (
                      <Select
                        error={!!err('photos')}
                        value={ph.albumId}
                        options={[
                          { value: '', label: albums === null ? t('Cargando…') : t('Elige un álbum') },
                          ...(albums ?? []).map((a) => ({ value: a.id, label: `${a.name || a.id} (${a.count})` })),
                          ...(ph.albumId && albums && !albums.some((a) => a.id === ph.albumId) ? [{ value: ph.albumId, label: t('Álbum no encontrado') }] : []),
                        ]}
                        onChange={(v) => upd(r.id, (x) => void (x.photos = { source: 'immich', albumId: v }))}
                      />
                    ) : (
                      <Callout kind="warn">{t('{name} no está disponible aquí. Elige otra opción.', { name: 'Immich' })}</Callout>
                    )}
                  </div>
                  {(err('text') || err('photos')) && (
                    <div class="field__error">
                      <Icon name="alert" size={13} /> {t(err('text') || err('photos'))}
                    </div>
                  )}
                </div>
                <ReorderButtons index={i} count={rules.length} onMove={move} />
                <button type="button" class="icon-btn icon-btn--danger" aria-label={t('Eliminar')} title={t('Eliminar')} onClick={() => write((list) => list.filter((x) => x.id !== r.id))}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {rules.length > 0 && cfg.privacy?.hidePhotos && <p class="muted small">{t('En modo privado se usan fotos de stock')}</p>}
      {pickingRule && pickingRule.photos.source === 'gallery' && gallery && (
        <PhotoPicker
          gallery={gallery}
          value={pickingRule.photos.files}
          onClose={(sel) => {
            if (sel) upd(pickingRule.id, (x) => void (x.photos = { source: 'gallery', files: sel }));
            setPicking(null);
          }}
        />
      )}
    </Card>
  );
}
