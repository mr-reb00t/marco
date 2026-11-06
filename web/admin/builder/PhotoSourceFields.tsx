// "Fotos" of a Personalizado photo card or of the sidebar's photo (#41): the screen's Fondo (the default) or photos of
// its own, with the Fondo's own fields (sections/PhotoOptions.tsx, sections/BackgroundRules.tsx): the source, the
// stock topic, the order, special backgrounds and the weather effect.
import type { BackgroundConfig, PhotoSource } from '../../shared/types';
import { Field, Segmented } from '../components/ui';
import { has } from '../caps';
import { t } from '../i18n';
import { startPhotoSource } from '../photoChoices';
import { PhotoPickFields, WeatherFxField } from '../sections/PhotoOptions';
import { RuleList } from '../sections/BackgroundRules';
import { photoSourceText } from './photoText';

export interface PhotoSourceEnv {
  /** the screen's Fondo as saved in the draft */
  screenBackground: BackgroundConfig;
  /** the calendars a special background may read (as the Fondo's rules) */
  ruleSources: { id: string; name: string; color: string; emoji: string }[];
  /** the screen hides its photos while private */
  privacy?: boolean;
}

/** `card`: a photo card (its weather effect starts off); else the sidebar's photo. `put` stores the whole block. */
export function PhotoSourceFields({ value, card, env, put }: { value: PhotoSource | undefined; card: boolean; env: PhotoSourceEnv; put: (v: PhotoSource) => void }) {
  const own = value?.mode === 'own';
  // "Propias" only where the server serves a card's own photos (a block already own keeps showing, so it can go back)
  if (!has('photoSources') && !own) return null;
  const bg = env.screenBackground;
  const edit = (fn: (v: PhotoSource) => void) => {
    const next = structuredClone(value ?? startPhotoSource(bg, card, { gallery: has('gallery'), immich: has('immich') }));
    fn(next);
    put(next);
  };
  return (
    <>
      <Field
        label={t('Fotos')}
        hint={own ? `${t('Empieza con las opciones del Fondo de la pantalla.')} ${t('Se ve en la pantalla al guardar.')}` : `${photoSourceText(bg)} ${t('Se cambian en la sección Fondo de esta pantalla.')}`}
      >
        <Segmented
          full
          value={own ? 'own' : 'screen'}
          options={[
            { value: 'screen', label: t('Como el Fondo de la pantalla') },
            { value: 'own', label: t('Propias'), off: !has('photoSources') },
          ]}
          onChange={(v) => edit((x) => void (x.mode = v))}
        />
      </Field>
      {own && value && (
        <>
          <PhotoPickFields value={value} edit={(fn) => edit((x) => fn(x))} privacy={env.privacy} />
          <h4 class="bld-h">{t('Fondos especiales')}</h4>
          <RuleList inline rules={value.rules} write={(fn) => edit((x) => void (x.rules = fn(x.rules)))} sources={env.ruleSources} privacy={env.privacy} />
          <WeatherFxField card={card} label={t('Efecto del tiempo')} value={value.weatherFx} onChange={(v) => edit((x) => void (x.weatherFx = v))} />
        </>
      )}
    </>
  );
}
