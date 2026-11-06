import type { PortraitFit } from '../../shared/types';
import { Callout, Card, Field, PageHeader, Segmented, Select, Slider, ToggleRow } from '../components/ui';
import { t } from '../i18n';
import { effectiveBackground, setCanvasPhoto, sidebarOwnPhotos } from '../../shared/glass';
import { canvasCards } from '../../../server/core/canvasCore.js';
import type { SectionProps } from './common';
import { BackgroundRulesCard } from './BackgroundRules';
import { PhotoPickFields, WeatherFxField } from './PhotoOptions';
import { intervalLabel, intervalsWith } from '../intervals';


export function BackgroundSection({ cfg, set, errors, full }: SectionProps) {
  const b = cfg.background;
  // a Personalizado screen shows the photo after its own Fondo in the editor: the switch follows it and sets it there
  const canvas = cfg.layout.preset === 'canvas' && cfg.canvas ? cfg.canvas : null;
  const shown = canvas ? !!effectiveBackground(b, canvas).enabled : b.enabled;
  const fx = b.weatherFx ?? 'simple';
  const fit: PortraitFit = b.portraitFit ?? 'auto';
  const intervals = intervalsWith(b.intervalSec);
  // the sidebar's photo of a Personalizado screen with an interval of its own (#41, set in the editor)
  const sideEvery = canvas && effectiveBackground(b, canvas).scope === 'side' && shown ? canvas.sidebar.intervalSec : undefined;
  // a photo card or the sidebar's photo with photos of its own (#41, set in the editor): the Fondo's do not apply there
  const ownPhotos = !!canvas && (!!sidebarOwnPhotos(canvas) || canvasCards(canvas.items).some((it) => it.kind === 'photo' && !it.hidden && (it.props as { photoSource?: { mode?: string } }).photoSource?.mode === 'own'));
  return (
    <>
      <PageHeader scope="screen" title={t('Fondo')} desc={t('Fotos de fondo, transiciones y efectos ambientales animados.')} />
      <Card id="bg-photos" scope="screen" title={t('Fotos de fondo')} icon="image">
        <ToggleRow
          label={t('Mostrar fotos de fondo')}
          hint={canvas ? t('En una pantalla Personalizado también se elige en el editor, en Fondo: Foto, Animado o Color.') : undefined}
          checked={shown}
          onChange={(v) =>
            set((d) => {
              if (d.layout.preset === 'canvas' && d.canvas) setCanvasPhoto(d.canvas, v);
              else d.background.enabled = v;
            })
          }
        />
        {ownPhotos && <Callout>{t('La barra lateral o una tarjeta Foto de esta pantalla tiene sus propias fotos. Se cambian en el editor.')}</Callout>}
        <div class={`stack ${shown ? '' : 'is-disabled'}`}>
          <PhotoPickFields value={b} edit={(fn) => set((d) => fn(d.background))} errors={errors} errPrefix="background" privacy={!!cfg.privacy?.hidePhotos} />
          <div class="grid grid--2">
            <Field
              label={t('Cambiar foto cada')}
              error={errors['background.intervalSec']}
              hint={sideEvery ? t('En la barra lateral de esta pantalla la foto cambia cada {interval}, como se eligió en el editor.', { interval: intervalLabel(sideEvery) }) : undefined}
            >
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
        <WeatherFxField value={fx} error={errors['background.weatherFx']} onChange={(v) => set((d) => void (d.background.weatherFx = v))} />
      </Card>
    </>
  );
}
