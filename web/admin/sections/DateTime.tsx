import { useEffect, useMemo, useState } from 'preact/hooks';
import { DATE_FORMATS, type DateFormat, type Lang } from '../../shared/types';
import { formatDateLine } from '../../shared/i18n';
import { Card, Field, PageHeader, Segmented, Slider, TextInput, ToggleRow } from '../components/ui';
import { ScopeBadge } from '../components/ui';
import { t } from '../i18n';
import type { SectionProps } from './common';


/** The display's own date line for `d` in time zone `tz`, so the preview matches the screen. */
export function formatDate(d: Date, fmt: DateFormat, lang: Lang, tz: string, custom = '') {
  let key: string;
  try {
    key = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(d);
  } catch {
    key = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
  return formatDateLine(lang, key.slice(0, 10), fmt, custom);
}

/** Small tag next to the numeric formats, so day/month order is clear even on days like 10/10. */
const FORMAT_TAG: Partial<Record<DateFormat, string>> = {
  weekday_mdy: 'mm/dd/aaaa',
  weekday_dmy: 'dd/mm/aaaa',
  weekday_iso: 'ISO 8601',
};

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Analog({ now, tz }: { now: Date; tz: string }) {
  let h = now.getHours(),
    m = now.getMinutes(),
    s = now.getSeconds();
  try {
    const p = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', timeZone: tz }).formatToParts(now);
    h = +p.find((x) => x.type === 'hour')!.value;
    m = +p.find((x) => x.type === 'minute')!.value;
    s = +p.find((x) => x.type === 'second')!.value;
  } catch {
    /* fall back to local */
  }
  const hand = (deg: number, len: number, w: number, cls: string) => (
    <line x1="50" y1="50" x2={50 + len * Math.sin((deg * Math.PI) / 180)} y2={50 - len * Math.cos((deg * Math.PI) / 180)} stroke-width={w} class={cls} stroke-linecap="round" />
  );
  return (
    <svg viewBox="0 0 100 100" class="analog">
      <circle cx="50" cy="50" r="47" class="analog__face" />
      {Array.from({ length: 12 }, (_, i) => (
        <line x1="50" y1="7" x2="50" y2={i % 3 ? 11 : 14} transform={`rotate(${i * 30} 50 50)`} class="analog__tick" stroke-width={i % 3 ? 1.2 : 2.4} />
      ))}
      {hand((h % 12) * 30 + m / 2, 24, 4, 'analog__h')}
      {hand(m * 6 + s / 10, 34, 2.6, 'analog__m')}
      {hand(s * 6, 38, 1.2, 'analog__s')}
      <circle cx="50" cy="50" r="2.6" class="analog__pin" />
    </svg>
  );
}

export function DateTimeSection({ cfg, set, errors }: SectionProps) {
  const d = cfg.datetime;
  const now = useNow();
  const zones = useMemo(() => {
    try {
      return (Intl as any).supportedValuesOf?.('timeZone') as string[] | undefined;
    } catch {
      return undefined;
    }
  }, []);
  let time = '';
  try {
    time = new Intl.DateTimeFormat('en-GB', {
      hour: d.format24 ? '2-digit' : 'numeric',
      minute: '2-digit',
      second: d.showSeconds ? '2-digit' : undefined,
      hourCycle: d.format24 ? 'h23' : 'h12',
      timeZone: d.timezone || undefined,
    }).format(now);
  } catch {
    time = now.toLocaleTimeString();
  }
  if (!d.format24) {
    const ampm = /am|pm/i.exec(time)?.[0]?.toUpperCase();
    time = time.replace(/\s?(am|pm)/i, '');
    if (d.showAmPm && ampm) time += ` ${ampm}`;
  }
  const lang = cfg.screen.language;
  return (
    <>
      <PageHeader scope="screen" title={t('Fecha y hora')} desc={t('Reloj con segundos, formato de fecha y zona horaria.')} />
      <Card>
        <div class="clock-preview">
          {d.clock === 'analog' ? <Analog now={now} tz={d.timezone} /> : <div class="clock-preview__time">{time}</div>}
          <div class="clock-preview__date">{formatDate(now, d.dateFormat, lang, d.timezone, d.dateCustom)}</div>
        </div>
        <ToggleRow label={t('Mostrar fecha y hora')} checked={d.enabled} onChange={(v) => set((c) => void (c.datetime.enabled = v))} />
      </Card>
      <Card id="dt-clock" scope="screen" title={t('Reloj')} icon="clock" muted={!d.enabled}>
        <div class="grid grid--2">
          <Field label={t('Estilo')}>
            <Segmented
              full
              value={d.clock}
              options={[
                { value: 'digital', label: t('Digital') },
                { value: 'analog', label: t('Analógico') },
              ]}
              onChange={(v) => set((c) => void (c.datetime.clock = v))}
            />
          </Field>
          <Field label={t('Formato')}>
            <Segmented
              full
              value={d.format24 ? 24 : 12}
              options={[
                { value: 24, label: '24 h' },
                { value: 12, label: '12 h' },
              ]}
              onChange={(v) => set((c) => void (c.datetime.format24 = v === 24))}
            />
          </Field>
        </div>
        <Field label={t('Posición')} hint={t('Automática: donde lo pone el diseño. Con la fecha y los avisos de debajo.')}>
          <Segmented
            full
            value={d.clockAlign ?? 'auto'}
            options={[
              { value: 'auto', label: t('Automática') },
              { value: 'left', label: t('Izquierda') },
              { value: 'center', label: t('Centro') },
              { value: 'right', label: t('Derecha') },
            ]}
            onChange={(v) => set((c) => void (c.datetime.clockAlign = v))}
          />
        </Field>
        <Field label={t('Tamaño')} hint={t('Nunca pasa del ancho de su panel: para un reloj más grande, ensancha el panel o quita los segundos.')}>
          <Slider value={Math.round((d.clockSize ?? 1) * 100)} min={60} max={160} step={5} format={(v) => `${v} %`} onChange={(v) => set((c) => void (c.datetime.clockSize = v / 100))} />
        </Field>
        <ToggleRow label={t('Mostrar segundos')} checked={d.showSeconds} onChange={(v) => set((c) => void (c.datetime.showSeconds = v))} />
        <ToggleRow label={t('Mostrar AM/PM')} hint={d.format24 ? t('Solo con formato de 12 horas') : undefined} disabled={d.format24} checked={d.showAmPm} onChange={(v) => set((c) => void (c.datetime.showAmPm = v))} />
        <Field label={<>{t('Zona horaria')} <ScopeBadge scope="global" /></>} error={errors['datetime.timezone']}>
          <TextInput value={d.timezone} list="tz-list" error={!!errors['datetime.timezone']} onValue={(v) => set((c) => void (c.datetime.timezone = v))} prefix={<span>🌍</span>} />
          {zones && (
            <datalist id="tz-list">
              {zones.map((z) => (
                <option value={z} />
              ))}
            </datalist>
          )}
        </Field>
      </Card>
      <Card id="dt-format" scope="screen" title={t('Formato de fecha')} icon="calendar" muted={!d.enabled}>
        <div class="radio-list radio-list--grid">
          {DATE_FORMATS.map((f) => (
            <label class={`radio-card ${d.dateFormat === f ? 'is-active' : ''}`}>
              <input type="radio" name="datefmt" checked={d.dateFormat === f} onChange={() => set((c) => void (c.datetime.dateFormat = f))} />
              <span class="radio-dot" />
              <span>{f === 'custom' ? t('Personalizado') : formatDate(now, f, lang, d.timezone)}</span>
              {FORMAT_TAG[f] && <span class="badge badge--soft mono small">{t(FORMAT_TAG[f]!)}</span>}
            </label>
          ))}
        </div>
        {d.dateFormat === 'custom' && <CustomDate d={d} now={now} lang={lang} set={set} />}
      </Card>
    </>
  );
}

const TOKENS: [string, string][] = [
  ['dddd', 'día de la semana'], ['ddd', 'día abreviado'], ['d', 'día'], ['dd', 'día con cero'],
  ['mmmm', 'mes'], ['mmm', 'mes abreviado'], ['m', 'mes en número'], ['mm', 'mes con cero'],
  ['yyyy', 'año'], ['yy', 'año corto'],
];

/** Pattern input for the custom date line: clickable variables and a live preview. */
function CustomDate({ d, now, lang, set }: { d: { dateCustom?: string; timezone: string }; now: Date; lang: Lang; set: SectionProps['set'] }) {
  const value = d.dateCustom ?? '';
  const insert = (tok: string) => set((c) => void (c.datetime.dateCustom = `${c.datetime.dateCustom ?? ''}{${tok}}`.slice(0, 60)));
  return (
    <div class="date-custom">
      <Field label={t('Tu formato')} hint={t('Escribe el texto que quieras y añade variables entre llaves.')}>
        <TextInput mono value={value} maxLength={60} placeholder="{dddd}, {d} {mmmm} {yyyy}" onValue={(v) => set((c) => void (c.datetime.dateCustom = v.replace(/[<>]/g, '')))} />
      </Field>
      <div class="date-custom__preview">
        <span class="muted small">{t('Así se verá')}</span>
        <strong>{value.trim() ? formatDate(now, 'custom', lang, d.timezone, value) : '·'}</strong>
      </div>
      <div class="date-custom__tokens">
        {TOKENS.map(([tok, label]) => (
          <button type="button" class="chip" onClick={() => insert(tok)} title={t(label)}>
            <code>{`{${tok}}`}</code>
            <span class="muted small">{formatDate(now, 'custom', lang, d.timezone, `{${tok}}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
