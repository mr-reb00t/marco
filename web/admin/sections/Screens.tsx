import { useEffect, useState } from 'preact/hooks';
import { slugify, SLUG_RE } from '../../shared/screens';
import type { DisplayInfo, ScreenProfile } from '../../shared/types';
import { api, ApiError } from '../api';
import { openPairDialog, shareOrigin } from '../components/DisplayAccess';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { canCopy, copyText } from '../components/share';
import { Button, Callout, Card, Field, Modal, PageHeader, ReorderButtons, Select, TextInput } from '../components/ui';
import { atLimit, limit } from '../caps';
import { screenHref, useDisplayLinks } from '../displayLinks';
import { LimitNote } from '../components/LimitNote';
import { t } from '../i18n';
import { takeIntent } from '../intent';
import { clone, moveItem, uid } from '../util';
import { pruneCarousels } from '../../shared/carousels';
import { withPollNote } from '../liveNote';
import type { SectionProps } from './common';

const PRESET_LABEL: Record<string, string> = { bigCalendar: 'Calendario grande', leftRight: 'Izquierda / derecha', topBottom: 'Arriba / abajo', bigTime: 'Reloj grande', agenda: 'Agenda', today: 'Hoy', people: 'Por persona', photoFrame: 'Marco de fotos', twoWeeks: 'Dos semanas', board: 'Tablero', bedside: 'Mesilla', planner: 'Planificador', widget: 'Widget', kidsRoutines: 'Rutinas', kidsFamily: 'Familia', kidsMeals: 'Semana de comidas', canvas: 'Personalizado' };

function uniqueSlug(base: string, taken: Set<string>) {
  let s = slugify(base) || 'pantalla';
  for (let i = 2, b = s; taken.has(s); i++) s = `${b.slice(0, 29)}-${i}`;
  return s;
}

function NewScreenDialog({
  screens,
  carouselSlugs,
  onClose,
  onCreate,
}: {
  screens: ScreenProfile[];
  carouselSlugs: string[];
  onClose: () => void;
  onCreate: (p: ScreenProfile) => void;
}) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const taken = new Set([...screens.map((s) => s.slug), ...carouselSlugs]);
  const slug = uniqueSlug(name || 'pantalla', taken);
  const SUGGEST = ['Cocina', 'Entrada', 'Oficina', 'Dormitorio', 'Habitación niños'];
  const create = async (e?: Event) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    let p: ScreenProfile;
    const src = screens.find((s) => s.id === from);
    if (src) {
      p = clone(src);
      p.id = uid('s');
    } else {
      try {
        p = await api.screenTemplate(name.trim());
      } catch {
        // Older server without the template endpoint: start from the first screen's settings.
        p = clone(screens[0]);
        p.id = uid('s');
      }
    }
    p.name = name.trim();
    p.slug = taken.has(p.slug) || !SLUG_RE.test(p.slug) || src ? slug : p.slug;
    if (screens.some((s) => s.id === p.id)) p.id = uid('s');
    setBusy(false);
    onCreate(p);
  };
  return (
    <Modal
      title={t('Nueva pantalla')}
      icon="monitor"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" icon="plus" loading={busy} disabled={!name.trim()} onClick={create}>
            {t('Crear pantalla')}
          </Button>
        </>
      }
    >
      <form class="stack" onSubmit={create}>
        <Field label={t('Nombre')} hint={name ? `${t('Dirección')}: /?screen=${slug}` : t('Por ejemplo: Cocina, Entrada…')}>
          <TextInput value={name} onValue={setName} placeholder={t('Cocina')} maxLength={60} />
        </Field>
        <div class="quick-add">
          {SUGGEST.filter((s) => !screens.some((x) => x.name.toLowerCase() === t(s).toLowerCase())).map((s) => (
            <button type="button" class="pill" onClick={() => setName(t(s))}>
              {t(s)}
            </button>
          ))}
        </div>
        <Field label={t('Empezar con')}>
          <Select value={from} options={[{ value: '', label: t('Ajustes predeterminados') }, ...screens.map((s) => ({ value: s.id, label: t('Copia de {name}', { name: s.name }) }))]} onChange={setFrom} />
        </Field>
        <p class="muted small">{t('Los calendarios, cumpleaños, filtros y avisos son comunes a todas las pantallas; cada pantalla tiene su propio diseño, fondo, vista y widgets.')}</p>
      </form>
    </Modal>
  );
}

export function ScreensSection({ full, setFull, saved, screenId, setScreenId, go, dirty, save }: SectionProps) {
  const [creating, setCreating] = useState(() => takeIntent('screens', 'new'));
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  useEffect(() => {
    api
      .displays()
      .then((r) => setDisplays(r.displays))
      .catch(() => {});
  }, []);
  // Private mode (default): a device opens its screen's private link or is paired; ?screen= only works in open mode
  // (and in this admin's own previews).
  const openMode = saved.security?.displayAccess === 'open';
  const linkState = useDisplayLinks(saved);
  const links = linkState.data;
  const screens = full.screens;
  // a carousel's address is taken too (the server never lets a screen and a carousel share one)
  const carouselSlugs = (full.carousels?.items ?? []).map((c) => c.slug);
  const taken = (exceptId: string) => new Set([...screens.filter((s) => s.id !== exceptId).map((s) => s.slug), ...carouselSlugs]);
  const upd = (id: string, fn: (s: ScreenProfile) => void) =>
    setFull((d) => {
      const s = d.screens.find((x) => x.id === id);
      if (s) fn(s);
    });
  const move = (a: number, b: number) => setFull((d) => void (d.screens = moveItem(d.screens, a, b)));
  const origin = openMode ? location.origin : shareOrigin(links) || location.origin;
  const linkOf = (id: string) => links?.links.find((l) => l.screenId === id);

  const duplicate = (s: ScreenProfile) => {
    if (atLimit('screens', screens.length)) return toast(t('Máximo {n} pantallas', { n: limit('screens') ?? screens.length }), 'error');
    const p = clone(s);
    p.id = uid('s');
    p.name = t('{name} (copia)', { name: s.name }).slice(0, 60);
    p.slug = uniqueSlug(p.name, taken(''));
    setFull((d) => void d.screens.splice(d.screens.findIndex((x) => x.id === s.id) + 1, 0, p));
    setScreenId(p.id);
    toast(t('Pantalla duplicada · guarda para aplicar'), 'info');
  };

  const remove = async (s: ScreenProfile) => {
    if (screens.length <= 1) return;
    const n = displays.filter((d) => d.connected && d.screenId === s.id).length;
    // Scheduled messages that only target this screen: an empty list would mean "all screens",
    // so they get disabled instead (the server applies the same rule on save/import).
    const orphans = full.schedules.items.filter((m) => m.screenIds.length > 0 && m.screenIds.every((x) => x === s.id));
    // carousels that show this screen lose its steps (and are turned off when none is left)
    const inCarousels = (full.carousels?.items ?? []).filter((c) => c.steps.some((st) => st.screenId === s.id) || c.offScreenId === s.id);
    const ok = await confirmDialog({
      title: t('Eliminar la pantalla “{name}”', { name: s.name }),
      body: (
        <>
          <p>{t('Se borrarán su diseño y sus ajustes. Los calendarios y demás contenido común no se tocan.')}</p>
          <p>{t('Las teles emparejadas con esta pantalla se desconectan y su enlace privado deja de funcionar.')}</p>
          {n > 0 && <p class="err-text">{t('{n} pantallas conectadas la usan: pasarán a mostrar la pantalla predeterminada.', { n })}</p>}
          {orphans.length > 0 && (
            <>
              <p class="err-text">{t('Estos mensajes programados solo se muestran en esta pantalla y se desactivarán:')}</p>
              <ul>
                {orphans.map((m) => (
                  <li key={m.id}>{`${m.emoji ? m.emoji + ' ' : ''}${m.title || t('(sin título)')}`}</li>
                ))}
              </ul>
            </>
          )}
          {inCarousels.length > 0 && (
            <>
              <p class="err-text">{t('Estos carruseles dejarán de mostrarla:')}</p>
              <ul>
                {inCarousels.map((c) => (
                  <li key={c.id}>{c.name}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ),
      confirm: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    setFull((d) => {
      d.screens = d.screens.filter((x) => x.id !== s.id);
      if (d.defaultScreen === s.id) d.defaultScreen = d.screens[0].id;
      for (const m of d.schedules.items) {
        const keep = m.screenIds.filter((x) => x !== s.id);
        if (m.screenIds.length && !keep.length) m.enabled = false;
        m.screenIds = keep;
      }
      // same rule as the server (server/core/carousels.js pruneCarousels)
      if (d.carousels) d.carousels.items = pruneCarousels(d.carousels.items, d.screens.map((x) => x.id));
    });
    if (screenId === s.id) setScreenId(screens.find((x) => x.id !== s.id)!.id);
  };

  // copyText also works on plain-http LAN pages, where the browser has no async clipboard
  const copy = async (text: string) => {
    if (await copyText(text)) toast(t('Copiado'), 'ok', 1500);
    else toast(text, 'info', 6000);
  };

  const reload = async (s: ScreenProfile) => {
    try {
      await api.refreshDisplays([s.id]);
      toast(withPollNote(t('Recargando {name}…', { name: s.name })), 'info');
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  return (
    <>
      <PageHeader title={t('Pantallas')} desc={
          (openMode
            ? t('Cada pantalla (salón, cocina, entrada…) tiene su propio diseño y widgets. Abre /?screen=<dirección> en cada dispositivo.')
            : t('Cada pantalla (salón, cocina, entrada…) tiene su propio diseño y widgets. Cada dispositivo abre el enlace privado de su pantalla o se vincula con un código.')) +
          ' ' + t('Una pantalla es un conjunto de ajustes, no un aparato: varios dispositivos pueden mostrar la misma, y un carrusel puede alternar varias.')
        }>
        <Button variant="primary" icon="plus" disabled={atLimit('screens', screens.length)} onClick={() => setCreating(true)}>
          {t('Nueva pantalla')}
        </Button>
      </PageHeader>
      <LimitNote name="screens" count={screens.length} />
      <div class="screen-cards" id="scr-list">
        {screens.map((s, i) => {
          const isDefault = s.id === full.defaultScreen;
          const isNew = !saved.screens.some((x) => x.id === s.id);
          const savedSlug = saved.screens.find((x) => x.id === s.id)?.slug;
          const slugChanged = !!savedSlug && savedSlug !== s.slug;
          const slugOk = SLUG_RE.test(s.slug) && !taken(s.id).has(s.slug);
          const ds = displays.filter((d) => d.screenId === s.id);
          const on = ds.filter((d) => d.connected).length;
          const link = linkOf(s.id);
          // Copy: open mode → the ?screen= address; private → the screen's private link (none until saved).
          const url = openMode ? `${origin}/?screen=${s.slug}` : link ? `${origin}${link.path}` : '';
          return (
            <section class={`screen-card ${s.id === screenId ? 'is-current' : ''}`} style={{ '--sc': s.screen.accent } as any} key={s.id}>
              <div class="screen-card__thumb" aria-hidden="true">
                <div class={`mini-layout mini-layout--${s.layout.preset} ${s.layout.sidePanel === 'right' ? 'is-right' : ''} ${s.screen.theme === 'light' ? 'is-light' : ''} ${s.screen.orientation === 'portrait' ? 'is-portrait' : ''}`}>
                  <span class="ml-a" />
                  <span class="ml-b" />
                  <span class="ml-c" />
                </div>
              </div>
              <div class="screen-card__body">
                <div class="screen-card__head">
                  <TextInput class="screen-card__name" value={s.name} maxLength={60} onValue={(v) => upd(s.id, (x) => void (x.name = v))} error={!s.name.trim()} />
                  {isDefault ? (
                    <span class="badge badge--accent" title={t('Se muestra cuando la URL no indica pantalla')}>
                      ★ {t('Predeterminada')}
                    </span>
                  ) : (
                    <button type="button" class="link-btn small" onClick={() => setFull((d) => void (d.defaultScreen = s.id))}>
                      ☆ {t('Hacer predeterminada')}
                    </button>
                  )}
                  {isNew && <span class="badge badge--soft">{t('Nueva')}</span>}
                </div>
                {openMode ? (
                  <div class="screen-card__slug">
                    <TextInput
                      mono
                      class="input--sm"
                      value={s.slug}
                      error={!slugOk}
                      prefix={<span class="mono small">{`${origin}/?screen=`}</span>}
                      onValue={(v) => upd(s.id, (x) => void (x.slug = v.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32)))}
                    />
                    <button type="button" class="icon-btn" title={t('Generar desde el nombre')} onClick={() => upd(s.id, (x) => void (x.slug = uniqueSlug(x.name, taken(s.id))))}>
                      <Icon name="wand" size={15} />
                    </button>
                    {canCopy() && (
                      <button type="button" class="icon-btn" title={t('Copiar URL')} disabled={!url} onClick={() => copy(url)}>
                        <Icon name="copy" size={15} />
                      </button>
                    )}
                  </div>
                ) : (
                  // Private links: the screen's own link, read only, ready to copy (the slug does not open anything here)
                  <div class="screen-card__slug screen-card__link">
                    <input
                      class="input input--mono input--sm"
                      value={url}
                      readOnly
                      spellcheck={false}
                      aria-label={t('Enlace privado')}
                      placeholder={isNew ? t('Guarda la pantalla para obtener su enlace privado.') : t('Cargando el enlace…')}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    {canCopy() && (
                      <button type="button" class="btn btn--sm btn--ghost" title={url ? t('Copiar enlace privado') : t('Guarda la pantalla para obtener su enlace privado.')} disabled={!url} onClick={() => copy(url)}>
                        <Icon name="copy" size={15} /> {t('Copiar')}
                      </button>
                    )}
                  </div>
                )}
                {openMode && !slugOk && <div class="field__error">{t('Solo minúsculas, números y guiones; no puede repetirse')}</div>}
                {openMode && slugChanged && slugOk && <div class="field__hint warn-text">{t('Las pantallas que usan ?screen={old} mostrarán la predeterminada hasta que cambies su URL.', { old: savedSlug! })}</div>}
                <div class="screen-card__meta">
                  <span>
                    <Icon name="layout" size={13} /> {t(PRESET_LABEL[s.layout.preset] ?? s.layout.preset)}
                  </span>
                  <span>{s.screen.language.toUpperCase()}</span>
                  <span>{s.screen.theme === 'light' ? t('Claro') : t('Oscuro')}</span>
                  <span>{s.calendar.sourceIds === null ? t('Todos los calendarios') : t('{n} calendarios', { n: s.calendar.sourceIds.length })}</span>
                  <span class={on ? 'ok-text' : 'muted'}>
                    <Icon name={on ? 'wifi' : 'wifiOff'} size={13} /> {on ? t('{n} en línea', { n: on }) : ds.length ? t('desconectada') : t('sin dispositivos')}
                  </span>
                </div>
                <div class="screen-card__actions">
                  <Button
                    size="sm"
                    variant={s.id === screenId ? 'primary' : 'default'}
                    icon="edit"
                    onClick={() => {
                      setScreenId(s.id);
                      go('layout');
                    }}
                  >
                    {s.id === screenId ? t('Editando') : t('Editar')}
                  </Button>
                  <Button size="sm" variant="ghost" icon="copy" disabled={atLimit('screens', screens.length)} onClick={() => duplicate(s)}>
                    {t('Duplicar')}
                  </Button>
                  {screenHref(saved, s.id, linkState) && (
                    <a class="btn btn--ghost btn--sm" href={screenHref(saved, s.id, linkState)!} target="_blank" rel="noopener">
                      <Icon name="external" size={15} />
                      <span>{t('Abrir')}</span>
                    </a>
                  )}
                  {on > 0 && (
                    <Button size="sm" variant="ghost" icon="refresh" onClick={() => reload(s)}>
                      {t('Recargar')}
                    </Button>
                  )}
                  <span class="screen-card__tail">
                    <ReorderButtons index={i} count={screens.length} onMove={move} />
                    <button type="button" class="icon-btn icon-btn--danger" disabled={screens.length <= 1} title={screens.length <= 1 ? t('Debe quedar al menos una pantalla') : t('Eliminar')} onClick={() => remove(s)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </span>
                </div>
              </div>
            </section>
          );
        })}
      </div>
      {dirty && screens.some((s) => !saved.screens.some((x) => x.id === s.id)) && (
        <Callout kind="info">
          {t('Las pantallas nuevas existen cuando guardes.')}{' '}
          <button type="button" class="link-btn" onClick={() => save()}>
            {t('Guardar ahora')}
          </button>
        </Callout>
      )}
      <Card title={t('Cómo asignar una pantalla a un dispositivo')} icon="info" muted={false}>
        {!openMode ? (
          <ol class="howto">
            <li>
              {t('Abre en el dispositivo el enlace privado de su pantalla (botón copiar de arriba, o')}{' '}
              <button type="button" class="link-btn" onClick={() => go('screen/scr-link')}>
                {t('Pantalla → Ajustes → Enlace privado')}
              </button>
              {t(', con su código QR).')}
            </li>
            <li>
              {t('O abre')} <code>{origin}/</code> {t('en el dispositivo y vincúlalo con el código que muestra:')}{' '}
              <button type="button" class="link-btn" onClick={() => openPairDialog()}>
                {t('Vincular una pantalla')}
              </button>
              .
            </li>
            <li>
              {t('En la Raspberry Pi pon el enlace privado en')} <code>KIOSK_URL</code> {t('en')} <code>~/.config/marco/kiosk.env</code>{' '}
              {t('y reinicia el kiosco (el kiosco olvida una vinculación al reiniciarse).')}
            </li>
            <li>
              {t('Comprueba qué ve cada dispositivo en')} <a href="#/displays">{t('Dispositivos conectados')}</a>.
            </li>
          </ol>
        ) : (
        <ol class="howto">
          <li>
            {t('Abre en el navegador del dispositivo')} <code>{origin}/?screen={t('cocina')}</code> {t('(cambia “{slug}” por la dirección de la pantalla).', { slug: t('cocina') })}
          </li>
          <li>
            {t('En la Raspberry Pi, edita')} <code>KIOSK_URL</code> {t('en')} <code>~/.config/marco/kiosk.env</code> {t('y reinicia el kiosco.')}
          </li>
          <li>
            {t('Sin ?screen= solo el propio servidor (http://localhost) muestra la pantalla predeterminada (★); desde otro equipo se ve «Abre el enlace de una pantalla». Comprueba qué ve cada dispositivo en')}{' '}
            <a href="#/displays">{t('Dispositivos conectados')}</a>.
          </li>
        </ol>
        )}
      </Card>
      {creating && (
        <NewScreenDialog
          carouselSlugs={carouselSlugs}
          screens={screens}
          onClose={() => setCreating(false)}
          onCreate={(p) => {
            if (atLimit('screens', screens.length)) return toast(t('Máximo {n} pantallas', { n: limit('screens') ?? screens.length }), 'error');
            setFull((d) => void d.screens.push(p));
            setScreenId(p.id);
            setCreating(false);
            toast(t('Pantalla “{name}” creada · guarda para aplicar', { name: p.name }), 'ok');
          }}
        />
      )}
    </>
  );
}
