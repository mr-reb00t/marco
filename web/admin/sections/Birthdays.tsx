import { useMemo, useRef, useState } from 'preact/hooks';
import type { Birthday, BirthdayCsvResult } from '../../shared/types';
import { api, ApiError } from '../api';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Callout, Card, ColorPicker, EmojiPicker, Empty, Modal, PageHeader, SearchInput, Segmented, Textarea, TextInput, ToggleRow } from '../components/ui';
import { fmtDay, monthNames, nextBirthday, relDays, todayIn } from '../dates';
import { t } from '../i18n';
import { atLimit, has, limit } from '../caps';
import { PrivacyModeField } from './Privacy';
import { LimitNote } from '../components/LimitNote';
import { takeIntent } from '../intent';
import { daysInMonth, normalize, uid } from '../util';
import { BIRTHDAY_NAME_MAX, parseVcards, planBirthdayImport, VCARD_MAX_BYTES, VCARD_MAX_CONTACTS, type ImportPlan, type ImportRow, type VcardParse } from '../vcard';
import type { SectionProps } from './common';

/** Client-side fallback of the server CSV parser (docs/ARCHITECTURE.md), used if the endpoint is unavailable. */
function parseCsvLocal(text: string, existing: Birthday[]): BirthdayCsvResult {
  const items: Birthday[] = [];
  const errors: BirthdayCsvResult['errors'] = [];
  let duplicates = 0;
  const yy = new Date().getFullYear() % 100;
  const key = (n: string, d: number, m: number) => `${normalize(n)}|${d}|${m}`;
  const seen = new Set(existing.map((b) => key(b.name, b.day, b.month)));
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[;,\t]/).map((s) => s.trim());
    if (i === 0 && /^(nombre|name|nome)$/i.test(parts[0]) ) return;
    const [name, date] = parts;
    const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(date ?? '');
    if (!name || !m) return void errors.push({ line: i + 1, text: raw, message: !name ? 'falta el nombre' : 'fecha no válida' });
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year: number | null = m[3] ? Number(m[3]) : null;
    if (year != null && m[3].length === 2) year += year <= yy ? 2000 : 1900;
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month) || (year != null && (year < 1900 || year > 2100))) return void errors.push({ line: i + 1, text: raw, message: 'fecha no válida' });
    const k = key(name, day, month);
    if (seen.has(k)) return void duplicates++;
    seen.add(k);
    items.push({ id: uid('b'), name: name.slice(0, 80), day, month, year, emoji: '' });
  });
  return { items, errors, duplicates };
}

function CsvDialog({ existing, onClose, onAdd }: { existing: Birthday[]; onClose: () => void; onAdd: (items: Birthday[]) => void }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState<BirthdayCsvResult | null>(null);
  const [busy, setBusy] = useState(false);
  const months = monthNames('short');
  const parse = async () => {
    setBusy(true);
    try {
      setRes(await api.parseBirthdaysCsv(text));
    } catch (e) {
      if ([404, 405].includes((e as ApiError).status)) setRes(parseCsvLocal(text, existing));
      else toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Importar cumpleaños')}
      icon="upload"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          {res && res.items.length > 0 ? (
            <Button variant="primary" icon="plus" onClick={() => onAdd(res.items)}>
              {t('Añadir {n} cumpleaños', { n: res.items.length })}
            </Button>
          ) : (
            <Button variant="primary" icon="play" loading={busy} disabled={!text.trim()} onClick={parse}>
              {t('Analizar')}
            </Button>
          )}
        </>
      }
    >
      <div class="stack">
        <p class="muted small">
          {t('Pega una línea por persona:')} <code>{t('nombre')};dd/mm</code> {t('o')} <code>{t('nombre')};{t('dd/mm/aaaa')}</code>. {t('También vale coma o tabulador (copiar desde una hoja de cálculo).')}
        </p>
        <Textarea
          mono
          rows={8}
          value={text}
          placeholder={'María;14/03/1990\nAbuelo Juan;02/11\nLucía,29/02/2016'}
          onValue={(v) => {
            setText(v);
            setRes(null);
          }}
        />
        {res && (
          <div class="csv-result">
            <div class="csv-result__sum">
              <span class="ok-text">
                <Icon name="check" size={14} /> {t('{n} válidos', { n: res.items.length })}
              </span>
              {res.duplicates > 0 && <span class="muted">{t('{n} ya existían', { n: res.duplicates })}</span>}
              {res.errors.length > 0 && (
                <span class="err-text">
                  <Icon name="alert" size={14} /> {t('{n} con errores', { n: res.errors.length })}
                </span>
              )}
            </div>
            {res.items.length > 0 && (
              <ul class="csv-result__list">
                {res.items.slice(0, 50).map((b) => (
                  <li>
                    <span>🎂</span> <strong>{b.name}</strong>{' '}
                    <span class="muted">
                      {b.day} {months[b.month - 1]}
                      {b.year ? ` ${b.year}` : ''}
                    </span>
                  </li>
                ))}
                {res.items.length > 50 && <li class="muted">… +{res.items.length - 50}</li>}
              </ul>
            )}
            {res.errors.length > 0 && (
              <ul class="csv-result__errs">
                {res.errors.slice(0, 20).map((e) => (
                  <li>
                    <span class="mono small">#{e.line}</span> <code>{e.text}</code> <span class="err-text">{t(e.message)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Where each service keeps its contacts export (Spanish keys; the services' own menu names per language). */
const VCF_HOWTO = [
  'Google Contactos: en contacts.google.com, «Exportar» y elige «vCard (para Contactos de iOS)».',
  'iCloud: en icloud.com/contacts, selecciona los contactos, abre el menú ⋯ y elige «Exportar vCard».',
  'Outlook: abre el contacto y usa «Archivo» → «Guardar como» → vCard. Puedes elegir varios archivos .vcf a la vez.',
  'Android: app Contactos → «Gestionar contactos» → «Exportar».',
];

/**
 * Birthdays from a contacts file (#43). The .vcf is read here (web/admin/vcard.ts) and never uploaded: only the rows
 * the owner ticks go into the draft. `room` is how many more fit (plan or validator limit).
 */
function VcardDialog({ existing, room, onClose, onAdd }: { existing: Birthday[]; room: number; onClose: () => void; onAdd: (rows: ImportRow[]) => void }) {
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [cards, setCards] = useState(0);
  const [files, setFiles] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const months = monthNames('short');

  /** A file that cannot be used: what was read before goes too, so nothing from it can be added. */
  const fail = (msg: string) => {
    setPlan(null);
    setFiles('');
    setPicked(new Set());
    setError(msg);
  };
  const read = async (list: File[]) => {
    if (!list.length) return;
    setError('');
    if (list.reduce((n, f) => n + f.size, 0) > VCARD_MAX_BYTES) return fail(t('El archivo pesa demasiado (máximo {n} MB).', { n: VCARD_MAX_BYTES / 1024 / 1024 }));
    setBusy(true);
    try {
      // Outlook saves one .vcf per contact: every chosen file is read, up to the contact cap in all
      const all: VcardParse = { contacts: [], cards: 0, capped: false };
      for (const f of list) {
        const r = parseVcards(new Uint8Array(await f.arrayBuffer()), VCARD_MAX_CONTACTS - all.cards);
        all.contacts.push(...r.contacts);
        all.cards += r.cards;
        all.capped ||= r.capped;
        if (all.capped) break;
      }
      if (!all.cards) return fail(t('No es un archivo de contactos (.vcf).'));
      const p = planBirthdayImport(all, existing);
      setPlan(p);
      setCards(all.cards);
      setFiles(list.length === 1 ? list[0].name : list.map((f) => f.name).join(', '));
      setPicked(new Set(p.rows.filter((r) => r.status === 'new').map((r) => r.key)));
      setQ('');
    } catch {
      fail(t('No se pudo leer el archivo.'));
    } finally {
      setBusy(false);
    }
  };

  const nq = normalize(q);
  const rows = plan ? plan.rows.filter((r) => !nq || normalize(r.name).includes(nq)) : [];
  const over = picked.size > room;
  const toggle = (key: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
  const skipped = plan
    ? [
        plan.skipped.noBday > 0 && t('{n} sin fecha de cumpleaños', { n: plan.skipped.noBday }),
        plan.skipped.badBday > 0 && t('{n} con una fecha que no se entiende', { n: plan.skipped.badBday }),
        plan.skipped.noName > 0 && t('{n} sin nombre', { n: plan.skipped.noName }),
      ].filter(Boolean)
    : [];

  return (
    <Modal
      title={t('Importar cumpleaños de tus contactos')}
      icon="users"
      size="lg"
      autoFocus={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" icon="plus" disabled={!plan || picked.size === 0 || over} onClick={() => plan && onAdd(plan.rows.filter((r) => picked.has(r.key)))}>
            {plan ? t('Añadir {n} cumpleaños', { n: picked.size }) : t('Añadir cumpleaños')}
          </Button>
        </>
      }
    >
      <div class="stack">
        <p class="muted small">{t('Elige un archivo de contactos (.vcf). Se lee en este navegador y no se envía a ningún sitio: solo se guardan los cumpleaños que añadas.')}</p>
        <div
          class={`dropzone dropzone--sm ${drag ? 'is-drag' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileRef.current?.click())}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void read([...(e.dataTransfer?.files ?? [])]);
          }}
        >
          <span class="dropzone__icon">{busy ? <span class="spinner" /> : <Icon name="upload" size={20} />}</span>
          <div class="vcf-drop__text">
            <strong>{files || t('Elegir archivo .vcf')}</strong>
            <div class="muted small">{t('o suéltalo aquí')}</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".vcf,.vcard,text/vcard,text/x-vcard"
            multiple
            hidden
            onChange={(e) => {
              void read([...(e.currentTarget.files ?? [])]);
              e.currentTarget.value = '';
            }}
          />
        </div>
        {error && <Callout kind="error">{error}</Callout>}
        {!plan && (
          <details class="pair-alt tunnel-guide">
            <summary>
              <Icon name="info" size={16} />
              <span>{t('Cómo exportar tus contactos')}</span>
              <Icon name="chevron" size={16} class="tunnel-guide__chev" />
            </summary>
            <ul class="vcf-howto">
              {VCF_HOWTO.map((s) => (
                <li>{t(s)}</li>
              ))}
            </ul>
          </details>
        )}
        {plan && (
          <div class="csv-result">
            <div class="csv-result__sum">
              <span>{t('{n} contactos leídos', { n: cards })}</span>
              <span>{t('{n} con cumpleaños', { n: plan.found })}</span>
              <span class="ok-text">
                <Icon name="check" size={14} /> {t('{n} nuevos', { n: plan.fresh })}
              </span>
              {plan.existing > 0 && <span class="muted">{t('{n} ya están en la lista', { n: plan.existing })}</span>}
              {plan.inFile > 0 && <span class="muted">{t('{n} repetidos en el archivo', { n: plan.inFile })}</span>}
            </div>
            {skipped.length > 0 && <div class="muted small">{skipped.join(' · ')}</div>}
            {plan.capped && <Callout kind="warn">{t('Solo se han leído los primeros {n} contactos.', { n: VCARD_MAX_CONTACTS })}</Callout>}
            {plan.rows.length === 0 ? (
              <Callout kind="info">
                <strong>{t('No hay ningún cumpleaños en este archivo.')}</strong> {t('Los contactos sin fecha de cumpleaños no se importan.')}
              </Callout>
            ) : (
              <>
                <div class="vcf-bar">
                  <button type="button" class="link-btn" disabled={plan.fresh === 0} onClick={() => setPicked(new Set(plan.rows.filter((r) => r.status === 'new').map((r) => r.key)))}>
                    {t('Seleccionar todos')}
                  </button>
                  <button type="button" class="link-btn" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>
                    {t('Desmarcar todos')}
                  </button>
                  <span class="muted small">{t('{n} seleccionados', { n: picked.size })}</span>
                </div>
                {plan.rows.length > 8 && <SearchInput value={q} onValue={setQ} placeholder={t('Buscar persona…')} />}
                <ul class="vcf-list">
                  {rows.map((r) => {
                    const old = r.status === 'existing';
                    const on = !old && picked.has(r.key);
                    return (
                      <li key={r.key}>
                        <label class={`gcal vcf-row ${on ? 'is-on' : ''} ${old ? 'is-dim' : ''}`}>
                          <input type="checkbox" checked={on} disabled={old} onChange={(e) => toggle(r.key, e.currentTarget.checked)} />
                          <span class="check-box">
                            <Icon name="check" size={12} />
                          </span>
                          <span class="gcal__name">{r.name}</span>
                          <span class="vcf-row__date muted small" title={r.yearDropped ? t('Año descartado: no parece un año de nacimiento') : undefined}>
                            {r.day} {months[r.month - 1]}
                            {r.year ? ` ${r.year}` : ` · ${t('sin año')}`}
                          </span>
                          {old && <span class="badge badge--soft">{t('Ya en la lista')}</span>}
                        </label>
                      </li>
                    );
                  })}
                  {q && rows.length === 0 && <li class="muted small">{t('Sin resultados')}</li>}
                </ul>
                {plan.truncated > 0 && <div class="muted small">{t('{n} nombres acortados a {max} letras', { n: plan.truncated, max: BIRTHDAY_NAME_MAX })}</div>}
              </>
            )}
            {over && <Callout kind="warn">{t('Caben {n} cumpleaños más (máximo {max}). Desmarca algunos para seguir.', { n: room, max: limit('birthdays') ?? existing.length + room })}</Callout>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function DayMonth({ day, month, onChange, error }: { day: number; month: number; onChange: (d: number, m: number) => void; error?: boolean }) {
  const months = monthNames('short');
  return (
    <div class={`daymonth ${error ? 'is-invalid' : ''}`}>
      <select class="daymonth__d" value={day} aria-label={t('Día')} onChange={(e) => onChange(Number(e.currentTarget.value), month)}>
        {Array.from({ length: daysInMonth(month) }, (_, i) => (
          <option value={i + 1}>{i + 1}</option>
        ))}
      </select>
      <select
        class="daymonth__m"
        value={month}
        aria-label={t('Mes')}
        onChange={(e) => {
          const m = Number(e.currentTarget.value);
          onChange(Math.min(day, daysInMonth(m)), m);
        }}
      >
        {months.map((n, i) => (
          <option value={i + 1}>{n}</option>
        ))}
      </select>
    </div>
  );
}

export function BirthdaysSection({ full, setFull, errors, cfg }: SectionProps) {
  const bd = full.birthdays;
  const today = todayIn(cfg.datetime.timezone);
  const [sort, setSort] = useState<'next' | 'name' | 'month'>('next');
  const [q, setQ] = useState('');
  const [csv, setCsv] = useState(false);
  const [vcf, setVcf] = useState(() => takeIntent('birthdays', 'vcard'));
  const [name, setName] = useState('');
  const [day, setDay] = useState(Number(today.slice(8)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [year, setYear] = useState('');
  const [emoji, setEmoji] = useState('');
  const [focusAdd] = useState(() => takeIntent('birthdays', 'add'));

  const rows = useMemo(() => {
    const nq = normalize(q);
    const list = bd.items.filter((b) => !nq || normalize(b.name).includes(nq)).map((b) => ({ b, next: nextBirthday(b, today) }));
    if (sort === 'next') list.sort((a, c) => a.next.days - c.next.days || a.b.name.localeCompare(c.b.name));
    else if (sort === 'name') list.sort((a, c) => a.b.name.localeCompare(c.b.name, undefined, { sensitivity: 'base' }));
    else list.sort((a, c) => a.b.month - c.b.month || a.b.day - c.b.day);
    return list;
  }, [bd.items, sort, q, today]);
  const upcoming = useMemo(() => bd.items.map((b) => ({ b, next: nextBirthday(b, today) })).sort((a, c) => a.next.days - c.next.days).slice(0, 4), [bd.items, today]);

  const upd = (id: string, fn: (b: Birthday) => void) =>
    setFull((d) => {
      const b = d.birthdays.items.find((x) => x.id === id);
      if (b) fn(b);
    });
  const atMax = atLimit('birthdays', bd.items.length);
  const yearNum = year.trim() ? Number(year) : null;
  const yearBad = yearNum != null && !(Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= 2100);
  const add = (e: Event) => {
    e.preventDefault();
    if (!name.trim() || yearBad || atMax) return;
    if (bd.items.some((b) => normalize(b.name) === normalize(name) && b.day === day && b.month === month)) {
      toast(t('Ese cumpleaños ya está en la lista'), 'info');
      return;
    }
    setFull((d) => void d.birthdays.items.push({ id: uid('b'), name: name.trim().slice(0, 80), day, month, year: yearNum, emoji }));
    toast(t('🎂 {name} añadido · guarda para publicarlo', { name: name.trim() }), 'ok', 2200);
    setName('');
    setYear('');
    setEmoji('');
  };
  const remove = async (b: Birthday) => {
    const ok = await confirmDialog({ title: t('Eliminar el cumpleaños de {name}', { name: b.name }), confirm: t('Eliminar'), danger: true });
    if (ok) setFull((d) => void (d.birthdays.items = d.birthdays.items.filter((x) => x.id !== b.id)));
  };

  const labelFor = (n: { days: number; age: number | null }) => (n.age != null && bd.showAge ? `${relDays(n.days)} · ${t('cumple {n}', { n: n.age })}` : relDays(n.days));

  return (
    <>
      <PageHeader title={t('Cumpleaños')} desc={t('Se muestran cada año en el calendario. Si indicas el año de nacimiento, la pantalla muestra la edad: “🎂 María (34)”.')}>
        <Button icon="upload" disabled={atMax} onClick={() => setCsv(true)}>
          {t('Importar CSV')}
        </Button>
        <Button icon="users" disabled={atMax} onClick={() => setVcf(true)}>
          {t('Importar contactos')}
        </Button>
      </PageHeader>

      {upcoming.length > 0 && (
        <div class="bday-next">
          {upcoming.map(({ b, next }) => (
            <div class={`bday-next__card ${next.days === 0 ? 'is-today' : ''}`}>
              <span class="bday-next__emoji">{b.emoji || bd.emoji || '🎂'}</span>
              <div>
                <strong>{b.name}</strong>
                <span class="muted small">
                  {fmtDay(next.date, { year: false })} · {labelFor(next)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Card title={t('Calendario de cumpleaños')} icon="cake" scope="global" id="bday-settings">
        <ToggleRow label={t('Mostrar cumpleaños')} checked={bd.enabled} onChange={(v) => setFull((d) => void (d.birthdays.enabled = v))} />
        <div class={`stack ${bd.enabled ? '' : 'is-disabled'}`}>
          <div class="legend-edit">
            <EmojiPicker value={bd.emoji} allowNone onChange={(v) => setFull((d) => void (d.birthdays.emoji = v))} />
            <ColorPicker compact value={bd.color} onChange={(v) => v && setFull((d) => void (d.birthdays.color = v))} />
            <TextInput value={bd.name} maxLength={60} placeholder={t('Cumpleaños')} onValue={(v) => setFull((d) => void (d.birthdays.name = v))} />
            <span class="muted small">{t('Nombre en la leyenda')}</span>
          </div>
          <ToggleRow icon="🔢" label={t('Mostrar la edad')} hint={t('Solo si conoces el año de nacimiento')} checked={bd.showAge} onChange={(v) => setFull((d) => void (d.birthdays.showAge = v))} />
          {has('privacy') && <PrivacyModeField value={bd.privacy ?? 'keep'} onChange={(v) => setFull((d) => void (d.birthdays.privacy = v))} />}
        </div>
        <ToggleRow
          icon="✂️"
          label={t('Ordenar los títulos de cumpleaños')}
          hint={t('Los cumpleaños de tus calendarios (por ejemplo «Cumpleaños de Ana» o «Ana\'s Birthday») se muestran solo con el nombre junto al 🎂. Desactívalo para ver el título tal como viene del calendario.')}
          checked={bd.tidyTitles !== false}
          onChange={(v) => setFull((d) => void (d.birthdays.tidyTitles = v))}
        />
      </Card>

      <Card
        title={t('Personas')}
        icon="list"
        id="bday-list"
        desc={t('{n} cumpleaños', { n: bd.items.length })}
        actions={
          <Segmented
            size="sm"
            value={sort}
            options={[
              { value: 'next', label: t('Próximos') },
              { value: 'month', label: t('Por mes') },
              { value: 'name', label: t('A-Z') },
            ]}
            onChange={setSort}
          />
        }
      >
        <form class="bday-add" onSubmit={add}>
          <EmojiPicker value={emoji} allowNone onChange={setEmoji} />
          <TextInput class="bday-add__name" value={name} onValue={setName} placeholder={t('Nombre')} maxLength={80} autoFocus={focusAdd} />
          <DayMonth
            day={day}
            month={month}
            onChange={(d, m) => {
              setDay(d);
              setMonth(m);
            }}
          />
          <input class={`input bday-add__year ${yearBad ? 'is-invalid' : ''}`} inputMode="numeric" placeholder={t('Año (opc.)')} value={year} maxLength={4} onInput={(e) => setYear(e.currentTarget.value.replace(/\D/g, ''))} />
          <Button type="submit" variant="primary" icon="plus" disabled={!name.trim() || yearBad || atMax}>
            {t('Añadir')}
          </Button>
        </form>
        <LimitNote name="birthdays" count={bd.items.length} />
        {bd.items.length > 8 && <SearchInput value={q} onValue={setQ} placeholder={t('Buscar persona…')} />}
        {bd.items.length === 0 ? (
          <Empty icon="cake" title={t('Aún no hay cumpleaños')}>
            {t('Añádelos uno a uno, pega una lista con “Importar CSV” o tráelos de tus contactos con “Importar contactos”.')}
          </Empty>
        ) : (
          <div class="bday-table">
            {rows.map(({ b, next }) => {
              const err = errors[`bday.${b.id}.name`] || errors[`bday.${b.id}.date`] || errors[`bday.${b.id}.year`];
              return (
                <div class={`bday-row ${next.days === 0 ? 'is-today' : ''} ${err ? 'has-err' : ''}`} key={b.id}>
                  <EmojiPicker value={b.emoji} allowNone onChange={(v) => upd(b.id, (x) => void (x.emoji = v))} />
                  <input class={`input input--bare bday-row__name ${errors[`bday.${b.id}.name`] ? 'is-invalid' : ''}`} value={b.name} maxLength={80} onInput={(e) => upd(b.id, (x) => void (x.name = e.currentTarget.value))} />
                  <DayMonth day={b.day} month={b.month} onChange={(d, m) => upd(b.id, (x) => ((x.day = d), (x.month = m)))} />
                  <input
                    class={`input bday-row__year ${errors[`bday.${b.id}.year`] ? 'is-invalid' : ''}`}
                    inputMode="numeric"
                    placeholder={t('Año')}
                    value={b.year ?? ''}
                    maxLength={4}
                    onInput={(e) => {
                      const v = e.currentTarget.value.replace(/\D/g, '');
                      upd(b.id, (x) => void (x.year = v ? Number(v) : null));
                    }}
                  />
                  <span class={`bday-row__next ${next.days <= 7 ? 'is-soon' : ''}`}>{labelFor(next)}</span>
                  <button type="button" class="icon-btn icon-btn--danger" aria-label={t('Eliminar')} onClick={() => remove(b)}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              );
            })}
            {q && rows.length === 0 && <div class="muted small">{t('Sin resultados')}</div>}
          </div>
        )}
        {Object.keys(errors).some((k) => k.startsWith('bday.')) && <Callout kind="error">{t('Revisa los cumpleaños marcados en rojo.')}</Callout>}
      </Card>
      {csv && (
        <CsvDialog
          existing={bd.items}
          onClose={() => setCsv(false)}
          onAdd={(items) => {
            const room = Math.max(0, (limit('birthdays') ?? Infinity) - bd.items.length);
            const added = items.slice(0, room);
            setFull((d) => void d.birthdays.items.push(...added));
            setCsv(false);
            toast(t('{n} cumpleaños añadidos · guarda para publicarlos', { n: added.length }), added.length ? 'ok' : 'info');
            if (added.length < items.length) toast(t('Has llegado al máximo ({max}).', { max: limit('birthdays') ?? bd.items.length }), 'info');
          }}
        />
      )}
      {vcf && (
        <VcardDialog
          existing={bd.items}
          room={Math.max(0, (limit('birthdays') ?? Infinity) - bd.items.length)}
          onClose={() => setVcf(false)}
          onAdd={(rows) => {
            const items = rows.map((r) => ({ id: uid('b'), name: r.name, day: r.day, month: r.month, year: r.year, emoji: '' }));
            setFull((d) => void d.birthdays.items.push(...items));
            setVcf(false);
            toast(t('{n} cumpleaños añadidos · guarda para publicarlos', { n: items.length }), 'ok');
          }}
        />
      )}
    </>
  );
}
