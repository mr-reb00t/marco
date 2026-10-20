import { useEffect, useState } from 'preact/hooks';
import type { AdminPhoto, AppConfig, ImmichAlbum, PortraitFit } from '../../shared/types';
import { api, ApiError } from '../api';
import { Icon } from '../components/icons';
import { Button, Callout, Card, Field, PageHeader, Segmented, Select, Slider, TextInput, ToggleRow } from '../components/ui';
import { has } from '../caps';
import { t } from '../i18n';
import type { SectionProps } from './common';
import { AlbumCover, immichErrorText } from './Immich';
import { BackgroundRulesCard } from './BackgroundRules';

const INTERVALS = [30, 60, 120, 300, 600, 900, 1800, 3600, 10800, 86400];

function intervalLabel(s: number) {
  if (s < 60) return t('{n} segundos', { n: s });
  if (s < 3600) return s === 60 ? t('1 minuto') : t('{n} minutos', { n: s / 60 });
  if (s < 86400) return s === 3600 ? t('1 hora') : t('{n} horas', { n: s / 3600 });
  return t('1 día');
}

export function BackgroundSection({ cfg, set, errors, full }: SectionProps) {
  const b = cfg.background;
  const fx = b.weatherFx ?? 'simple';
  const fit: PortraitFit = b.portraitFit ?? 'auto';
  const galleryOn = has('gallery');
  const immichOn = has('immich');
  const usesImmich = b.source === 'immich';
  const usesGallery = galleryOn && b.source !== 'stock' && !usesImmich;
  const [gallery, setGallery] = useState<AdminPhoto[] | null>(null);
  useEffect(() => {
    if (usesGallery && gallery === null) api.photos().then(setGallery, () => setGallery([]));
  }, [usesGallery]);
  const inRotation = gallery?.filter((p) => !p.hidden).length ?? 0;
  const intervals = INTERVALS.includes(b.intervalSec) ? INTERVALS : [...INTERVALS, b.intervalSec].sort((a, c) => a - c);
  return (
    <>
      <PageHeader scope="screen" title={t('Fondo')} desc={t('Fotos de fondo, transiciones y efectos ambientales animados.')} />
      <Card id="bg-photos" scope="screen" title={t('Fotos de fondo')} icon="image">
        <ToggleRow label={t('Mostrar fotos de fondo')} checked={b.enabled} onChange={(v) => set((d) => void (d.background.enabled = v))} />
        <div class={`stack ${b.enabled ? '' : 'is-disabled'}`}>
          {(galleryOn || immichOn || b.source !== 'stock') && (
            <Field label={t('Origen')}>
              <Segmented
                full
                value={b.source}
                options={[
                  { value: 'stock' as const, label: t('Stock'), icon: 'globe' as const },
                  ...(galleryOn || b.source === 'gallery' || b.source === 'mixed'
                    ? [
                        { value: 'gallery' as const, label: t('Mi galería'), icon: 'photos' as const },
                        { value: 'mixed' as const, label: t('Mezcla'), icon: 'sparkles' as const },
                      ]
                    : []),
                  ...(immichOn || usesImmich ? [{ value: 'immich' as const, label: 'Immich', icon: 'image' as const }] : []),
                ]}
                onChange={(v) => set((d) => void (d.background.source = v))}
              />
              {!galleryOn && (b.source === 'gallery' || b.source === 'mixed') && <Callout kind="warn">{t('{name} no está disponible aquí. Elige otra opción.', { name: t('Galería') })}</Callout>}
              {!immichOn && usesImmich && <Callout kind="warn">{t('{name} no está disponible aquí. Elige otra opción.', { name: 'Immich' })}</Callout>}
            </Field>
          )}
          {usesImmich && immichOn && <ImmichPicker cfg={cfg} set={set} errors={errors} />}
          {(!galleryOn || b.source !== 'gallery') && !usesImmich && (
            <Field label={t('Tema de las fotos de stock')} hint={t('Palabra clave orientativa (p. ej. naturaleza, mar, montaña).')}>
              <TextInput value={b.stockTopic} onValue={(v) => set((d) => void (d.background.stockTopic = v))} placeholder="nature" />
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
              hint={
                (b.order ?? 'random') === 'random'
                  ? t('Al azar, sin repetir las fotos de la tanda anterior.')
                  : t('Sigue donde lo dejó y vuelve a empezar al terminar.')
              }
              error={errors['background.order']}
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
                  onChange={(v) => set((d) => void (d.background.order = v))}
                />
              </div>
            </Field>
          )}
          <div class="grid grid--2">
            <Field label={t('Cambiar foto cada')} error={errors['background.intervalSec']}>
              <Select value={b.intervalSec} options={intervals.map((s) => ({ value: s, label: intervalLabel(s) }))} onChange={(v) => set((d) => void (d.background.intervalSec = v))} />
            </Field>
            <Field label={t('Brillo')}>
              <Slider value={b.brightness} min={0.2} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.background.brightness = v))} />
            </Field>
          </div>
          <ToggleRow label={t('Mostrar autor / título de la foto')} checked={b.showMeta} onChange={(v) => set((d) => void (d.background.showMeta = v))} />
          <ToggleRow label={t('Recortar para llenar la pantalla')} hint={t('Si se desactiva, la foto se muestra completa con bandas.')} checked={b.cover} onChange={(v) => set((d) => void (d.background.cover = v))} />
          {b.cover && (
            <Field
              label={t('Fotos verticales')}
              hint={
                fit === 'blur'
                  ? t('La foto se ve entera sobre una copia difuminada de sí misma.')
                  : fit === 'crop'
                    ? t('La foto se recorta para llenar la pantalla.')
                    : t('Fondo difuminado para las fotos de Immich; las demás se recortan.')
              }
              error={errors['background.portraitFit']}
            >
              <Segmented
                full
                value={fit}
                options={[
                  { value: 'auto' as PortraitFit, label: t('Automático') },
                  { value: 'blur' as PortraitFit, label: t('Fondo difuminado') },
                  { value: 'crop' as PortraitFit, label: t('Recortar') },
                ]}
                onChange={(v) => set((d) => void (d.background.portraitFit = v))}
              />
            </Field>
          )}
          <Field label={t('Transición entre fotos')}>
            <Segmented
              value={b.transition}
              options={[
                { value: 'webgl', label: t('WebGL (suave)') },
                { value: 'fade', label: t('Fundido') },
                { value: 'none', label: t('Ninguna') },
              ]}
              onChange={(v) => set((d) => void (d.background.transition = v))}
            />
          </Field>
        </div>
      </Card>
      <BackgroundRulesCard cfg={cfg} set={set} errors={errors} full={full} />
      <Card id="bg-ambient" scope="screen" title={t('Efecto ambiental')} icon="sparkles" desc={t('Animación three.js detrás del calendario. Limitada a 30 fps para la Raspberry Pi.')}>
        <div class="fx-grid">
          {(
            [
              { v: 'aurora', name: t('Aurora'), desc: t('Velos de color suaves que se mueven lentamente.') },
              { v: 'particles', name: t('Partículas'), desc: t('Polvo de luz flotando con profundidad.') },
              { v: 'none', name: t('Ninguno'), desc: t('Máximo rendimiento, sin WebGL.') },
            ] as const
          ).map((o) => (
            <button type="button" class={`fx ${b.ambient === o.v ? 'is-active' : ''}`} onClick={() => set((d) => void (d.background.ambient = o.v))}>
              <span class={`fx__swatch fx__swatch--${o.v}`} />
              <strong>{o.name}</strong>
              <small>{o.desc}</small>
            </button>
          ))}
        </div>
      </Card>
      <Card id="bg-weather" scope="screen" title={t('Efecto del tiempo')} icon="cloud" desc={t('Animación sobre la foto según el tiempo actual. Solo con WebGL, no se usa con ?lite=1.')}>
        <Field
          hint={
            fx === 'off'
              ? t('Sin lluvia ni nieve sobre la foto.')
              : fx === 'rich'
                ? t('Gotas en el cristal, nieve en capas y rayos de sol en los días despejados. La foto no se desenfoca. Algo más exigente para la Raspberry Pi.')
                : t('Partículas finas de lluvia o nieve. Lo más ligero.')
          }
          error={errors['background.weatherFx']}
        >
          <Segmented
            full
            value={fx}
            options={[
              { value: 'off', label: t('Desactivado') },
              { value: 'simple', label: t('Sencillo') },
              { value: 'rich', label: t('Realista') },
            ]}
            onChange={(v) => set((d) => void (d.background.weatherFx = v))}
          />
        </Field>
      </Card>
    </>
  );
}

/** Album picker of the Immich source: several albums (merged), favourites only, with search. */
function ImmichPicker({ cfg, set }: Pick<SectionProps, 'cfg' | 'set' | 'errors'>) {
  const sel = cfg.background.immich ?? { albumIds: [], favoritesOnly: false };
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
  const update = (fn: (im: { albumIds: string[]; favoritesOnly: boolean }) => void) =>
    set((d: AppConfig) => {
      const im = { albumIds: [...(d.background.immich?.albumIds ?? [])], favoritesOnly: d.background.immich?.favoritesOnly ?? false };
      fn(im);
      d.background.immich = im;
    });
  const toggle = (id: string) =>
    update((im) => {
      im.albumIds = im.albumIds.includes(id) ? im.albumIds.filter((x) => x !== id) : [...im.albumIds, id].slice(0, 20);
    });
  const needle = q.trim().toLowerCase();
  const shown = (albums ?? []).filter((a) => !needle || a.name.toLowerCase().includes(needle));
  const known = new Set((albums ?? []).map((a) => a.id));
  const gone = albums && !error ? sel.albumIds.filter((id) => !known.has(id)) : [];
  const priv = cfg.privacy?.hidePhotos;
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
          {albums && albums.length > 8 && (
            <TextInput value={q} onValue={setQ} placeholder={t('Buscar')} prefix={<Icon name="search" size={14} />} />
          )}
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
          <Button size="sm" variant="ghost" onClick={() => update((im) => void (im.albumIds = im.albumIds.filter((id) => known.has(id))))}>
            {t('Quitar')}
          </Button>
        </Callout>
      )}
      {!error && sel.albumIds.length === 0 && <Callout kind="warn">{t('Sin álbumes elegidos: se muestran fotos de stock')}</Callout>}
      <ToggleRow label={t('Solo favoritos')} checked={sel.favoritesOnly} onChange={(v) => update((im) => void (im.favoritesOnly = v))} />
      {priv && <Callout>{t('En modo privado se usan fotos de stock')}</Callout>}
    </>
  );
}
