// The photo options the screen's Fondo shares with a Personalizado photo card and the sidebar's photo (#41): where the
// photos come from (Stock, Mi galería, Mezcla, Immich albums), the stock topic, the order and the weather effect. The
// Fondo section and the builder both draw these, so the two always offer the same.
import { useEffect, useState } from 'preact/hooks';
import type { AdminPhoto, BackgroundConfig, ImmichAlbum } from '../../shared/types';
import { api, ApiError } from '../api';
import { Icon } from '../components/icons';
import { Button, Callout, Field, Segmented, TextInput, ToggleRow } from '../components/ui';
import { has } from '../caps';
import { t } from '../i18n';
import { sourceChoices, type PhotoSourceId } from '../photoChoices';
import { AlbumCover, immichErrorText } from './Immich';

/** The keys PhotoPickFields edits (a screen's background, a card's or the sidebar's photoSource). */
export type PhotoPick = Pick<BackgroundConfig, 'source' | 'stockTopic' | 'order' | 'immich'>;
type ImmichSel = { albumIds: string[]; favoritesOnly: boolean };

const SOURCE_LABEL: Record<PhotoSourceId, { label: () => string; icon: 'globe' | 'photos' | 'sparkles' | 'image' }> = {
  stock: { label: () => t('Stock'), icon: 'globe' },
  gallery: { label: () => t('Mi galería'), icon: 'photos' },
  mixed: { label: () => t('Mezcla'), icon: 'sparkles' },
  immich: { label: () => 'Immich', icon: 'image' },
};

/**
 * Origen, the Immich albums, the stock topic, the gallery note and the order. `edit` changes the value in place (a
 * draft); `errors` with `errPrefix` ('background', or none in the builder); `privacy`: the screen hides its photos
 * while private.
 */
export function PhotoPickFields({ value: b, edit, errors = {}, errPrefix = '', privacy = false }: {
  value: PhotoPick;
  edit: (fn: (v: PhotoPick) => void) => void;
  errors?: Record<string, string>;
  errPrefix?: string;
  privacy?: boolean;
}) {
  const galleryOn = has('gallery');
  const immichOn = has('immich');
  const usesImmich = b.source === 'immich';
  const usesGallery = galleryOn && b.source !== 'stock' && !usesImmich;
  const [gallery, setGallery] = useState<AdminPhoto[] | null>(null);
  useEffect(() => {
    if (usesGallery && gallery === null) api.photos().then(setGallery, () => setGallery([]));
  }, [usesGallery]);
  const inRotation = gallery?.filter((p) => !p.hidden).length ?? 0;
  const choices = sourceChoices({ gallery: galleryOn, immich: immichOn }, b.source);
  const err = (k: string) => (errPrefix ? errors[`${errPrefix}.${k}`] : undefined);
  return (
    <>
      {choices.length > 1 && (
        <Field label={t('Origen')} error={err('source')}>
          <Segmented full value={b.source} options={choices.map((v) => ({ value: v, label: SOURCE_LABEL[v].label(), icon: SOURCE_LABEL[v].icon }))} onChange={(v) => edit((x) => void (x.source = v))} />
          {!galleryOn && (b.source === 'gallery' || b.source === 'mixed') && <Callout kind="warn">{t('{name} no está disponible aquí. Elige otra opción.', { name: t('Galería') })}</Callout>}
          {!immichOn && usesImmich && <Callout kind="warn">{t('{name} no está disponible aquí. Elige otra opción.', { name: 'Immich' })}</Callout>}
        </Field>
      )}
      {usesImmich && immichOn && (
        <ImmichPicker
          sel={b.immich ?? { albumIds: [], favoritesOnly: false }}
          privacy={privacy}
          edit={(fn) =>
            edit((x) => {
              const im = { albumIds: [...(x.immich?.albumIds ?? [])], favoritesOnly: x.immich?.favoritesOnly ?? false };
              fn(im);
              x.immich = im;
            })
          }
        />
      )}
      {(!galleryOn || b.source !== 'gallery') && !usesImmich && (
        <Field label={t('Tema de las fotos de stock')} hint={t('Palabra clave orientativa (p. ej. naturaleza, mar, montaña).')}>
          <TextInput value={b.stockTopic} onValue={(v) => edit((x) => void (x.stockTopic = v))} placeholder="nature" />
        </Field>
      )}
      {usesGallery &&
        (gallery && gallery.length > 0 && inRotation === 0 ? (
          <Callout kind="warn">
            <strong>{t('Todas las fotos de la galería están ocultas.')}</strong>{' '}
            {t('Se mostrarán fotos de stock hasta que vuelvas a mostrar alguna en')}{' '}
            <a href="#/photos">
              <strong>{t('Galería')}</strong>
            </a>
            .
          </Callout>
        ) : (
          <Callout>
            {gallery && gallery.length > 0 ? `${t('{shown} de {total} en rotación', { shown: inRotation, total: gallery.length })}. ` : ''}
            {t('Gestiona tus fotos y elige cuáles se muestran en')}{' '}
            <a href="#/photos">
              <strong>{t('Galería')}</strong>
            </a>
            .
          </Callout>
        ))}
      {(usesGallery || (usesImmich && immichOn)) && (
        <Field
          label={t('Orden de las fotos')}
          hint={(b.order ?? 'random') === 'random' ? t('Al azar, sin repetir las fotos de la tanda anterior.') : t('Sigue donde lo dejó y vuelve a empezar al terminar.')}
          error={err('order')}
        >
          <div class="bg-order">
            <Segmented
              full
              value={b.order ?? 'random'}
              options={[
                { value: 'random', label: t('Aleatorio'), icon: 'sparkles' },
                { value: 'newest', label: t('Más recientes primero'), icon: 'history' },
                { value: 'name', label: usesImmich ? t('Por nombre de archivo') : t('Por nombre'), icon: 'list' },
              ]}
              onChange={(v) => edit((x) => void (x.order = v))}
            />
          </div>
        </Field>
      )}
    </>
  );
}

/** Album picker of the Immich source: several albums (merged), favourites only, with search. */
function ImmichPicker({ sel, edit, privacy }: { sel: ImmichSel; edit: (fn: (im: ImmichSel) => void) => void; privacy: boolean }) {
  const [albums, setAlbums] = useState<ImmichAlbum[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    api.immichAlbums().then(setAlbums, (e) => {
      const b = (e as ApiError).body as { error?: unknown } | undefined;
      setError(typeof b?.error === 'string' ? b.error : 'unreachable');
      setAlbums([]);
    });
  }, []);
  const toggle = (id: string) =>
    edit((im) => {
      im.albumIds = im.albumIds.includes(id) ? im.albumIds.filter((x) => x !== id) : [...im.albumIds, id].slice(0, 20);
    });
  const needle = q.trim().toLowerCase();
  const shown = (albums ?? []).filter((a) => !needle || a.name.toLowerCase().includes(needle));
  const known = new Set((albums ?? []).map((a) => a.id));
  const gone = albums && !error ? sel.albumIds.filter((id) => !known.has(id)) : [];
  return (
    <>
      {error === 'not_configured' ? (
        <Callout kind="warn">
          {t('Immich no está configurado')}.{' '}
          <a href="#/immich">
            <strong>{t('Configura Immich en Integraciones')}</strong>
          </a>
        </Callout>
      ) : error ? (
        <Callout kind="error">{immichErrorText(error)}</Callout>
      ) : (
        <Field label={t('Álbumes')} hint={`${t('Elige uno o más álbumes')}. ${t('Solo se muestran fotos.')}`}>
          {albums && albums.length > 8 && <TextInput value={q} onValue={setQ} placeholder={t('Buscar')} prefix={<Icon name="search" size={14} />} />}
          {albums === null ? (
            <p class="muted small">{t('Cargando…')}</p>
          ) : (
            <ul class="immich-albums immich-albums--pick" role="group">
              {shown.map((a) => {
                const on = sel.albumIds.includes(a.id);
                return (
                  <li>
                    <button type="button" class={`immich-album ${on ? 'is-active' : ''}`} aria-pressed={on} onClick={() => toggle(a.id)}>
                      <AlbumCover album={a} />
                      <span class="immich-album__text">
                        <strong>{a.name || a.id}</strong>
                        <small class="muted">{t('{n} fotos', { n: a.count })}</small>
                      </span>
                      {on && <Icon name="check" size={16} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Field>
      )}
      {gone.length > 0 && (
        <Callout kind="warn">
          {t('Álbum no encontrado')}: {gone.length}{' '}
          <Button size="sm" variant="ghost" onClick={() => edit((im) => void (im.albumIds = im.albumIds.filter((id) => known.has(id))))}>
            {t('Quitar')}
          </Button>
        </Callout>
      )}
      {!error && sel.albumIds.length === 0 && <Callout kind="warn">{t('Sin álbumes elegidos: se muestran fotos de stock')}</Callout>}
      <ToggleRow label={t('Solo favoritos')} checked={sel.favoritesOnly} onChange={(v) => edit((im) => void (im.favoritesOnly = v))} />
      {privacy && <Callout>{t('En modo privado se usan fotos de stock')}</Callout>}
    </>
  );
}

/**
 * "Efecto del tiempo": off, light or rich. `card`: over a photo card, a light layer drawn over that card only (no
 * drops on the glass, that needs the WebGL photo), which Ahorro, light mode and less motion turn off.
 */
export function WeatherFxField({ value, onChange, error, card = false, label }: { value: 'off' | 'simple' | 'rich'; onChange: (v: 'off' | 'simple' | 'rich') => void; error?: string; card?: boolean; label?: string }) {
  const hint = card
    ? value === 'off'
      ? t('Sin lluvia ni nieve sobre la foto.')
      : value === 'rich'
        ? t('Lluvia, nieve, niebla y sol sobre esta foto, sin gotas en el cristal.')
        : t('Lluvia o nieve sobre esta foto según el tiempo actual. No se muestra con Ahorro ni con ?lite=1.')
    : value === 'off'
      ? t('Sin lluvia ni nieve sobre la foto.')
      : value === 'rich'
        ? t('Gotas en el cristal, nieve en capas y rayos de sol en los días despejados. La foto no se desenfoca. Algo más exigente para la Raspberry Pi.')
        : t('Partículas finas de lluvia o nieve. Lo más ligero.');
  return (
    <Field label={label} hint={hint} error={error}>
      <Segmented
        full
        value={value}
        options={[
          { value: 'off', label: t('Desactivado') },
          { value: 'simple', label: t('Sencillo') },
          { value: 'rich', label: t('Realista') },
        ]}
        onChange={onChange}
      />
    </Field>
  );
}
