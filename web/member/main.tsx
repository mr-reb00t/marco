// A person's own dashboard on the phone (/my/<link>, or /my): family access (#16). No admin login. The private link
// or a code shown on one of the screens gets this phone a token of its own (header X-Member-Token), kept in this
// browser; the page then shows only what the admin allows this person: a message to the screens, privacy mode, night
// or day mode, a to-do and an event on the local calendar. Works over plain http on the home network (no service
// worker, no clipboard, no crypto API). The server checks every action again, so what the page shows is only a guide.
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { MemberAuthResponse, MemberState } from '../shared/types';
import { chipColors } from '../display/color';
import { initialLang, locale, setLang, t } from './i18n';
import '../shared/emoji-font.css';
import './styles.css';

const LS_TOKEN = 'marco.member.token';
const REFRESH_MS = 60_000;
const CODE_LENGTH = 6;
const CODE_CHARS = /[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g;

// ---- the token ----

const readToken = (): string | null => {
  try {
    return localStorage.getItem(LS_TOKEN);
  } catch {
    return null;
  }
};
const saveToken = (v: string | null) => {
  try {
    if (v) localStorage.setItem(LS_TOKEN, v);
    else localStorage.removeItem(LS_TOKEN);
  } catch {
    /* a private window: the token lives as long as the page */
  }
};
let token = readToken();

/** The link in the path (/my/<link>) and a code in the fragment (#code=…, from the QR code on a screen). */
function readStart(): { link: string | null; code: string | null } {
  const m = location.pathname.match(/^\/my\/([^/?#]+)/);
  const c = location.hash.match(/^#code=([A-Za-z0-9]+)/);
  return { link: m ? decodeURIComponent(m[1]) : null, code: c ? c[1].toUpperCase() : null };
}
const START = readStart();
// the link and the code are used once: neither stays in the address bar or the history entry
if (START.link || START.code) history.replaceState(null, '', '/my');

// ---- API ----

class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['X-Member-Token'] = token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, { method, headers, cache: 'no-store', credentials: 'omit', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'network');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new ApiError(res.status, data?.code || data?.error || `http_${res.status}`);
  return data as T;
}

const api = {
  redeem: (link: string) => call<MemberAuthResponse>('POST', '/api/member/redeem', { link, token: token ?? undefined }),
  pair: (code: string) => call<MemberAuthResponse>('POST', '/api/member/pair', { code }),
  state: () => call<MemberState>('GET', '/api/member/state'),
  message: (text: string, screens: string[], durationSec: number) => call<{ ok: true; delivered: number }>('POST', '/api/member/message', { text, screens, durationSec }),
  privacy: (mode: 'on' | 'off') => call<{ ok: true; privacy: { on: number; total: number } }>('POST', '/api/member/privacy', { mode }),
  night: (mode: 'on' | 'off' | 'auto') => call<{ ok: true; delivered: number }>('POST', '/api/member/night', { mode }),
  todo: (text: string) => call<{ ok: true }>('POST', '/api/member/todo', { text }),
  event: (b: { title: string; date: string; allDay: boolean; startTime?: string; endTime?: string }) => call<{ ok: true }>('POST', '/api/member/event', b),
  forget: () => call<{ ok: true }>('POST', '/api/member/forget', {}),
};

/** The text of an error, in the person's language. */
function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : '';
  const map: Record<string, string> = {
    network: 'Sin conexión. Comprueba la red e inténtalo otra vez.',
    rate_limited: 'Demasiados intentos. Espera un poco y vuelve a probar.',
    not_allowed: 'Ya no tienes permiso para esto.',
    invalid_code: 'Ese código no vale o ya ha caducado. Pide uno nuevo.',
    invalid_link: 'Este enlace ya no funciona. Pide uno nuevo.',
    device_limit: 'Ya hay demasiados móviles con tu acceso. Pide que quiten alguno.',
    text_required: 'Escribe algo primero.',
    text_too_long: 'Es demasiado largo.',
    title_required: 'Escribe un título.',
    title_too_long: 'El título es demasiado largo.',
    bad_date: 'Elige una fecha válida.',
    bad_time: 'Revisa las horas: el final va después del inicio.',
    todo_full: 'La lista de tareas está llena.',
    events_full: 'El calendario local está lleno.',
    calendar_off: 'El calendario local está apagado.',
  };
  return t(map[code] ?? 'No se pudo hacer. Inténtalo otra vez.');
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function minutesLabel(sec: number): string {
  if (sec < 3600) return t('{n} min', { n: Math.round(sec / 60) });
  return t('{n} h', { n: Math.round(sec / 3600) });
}

// ---- pieces ----

type Flash = { kind: 'ok' | 'error'; text: string } | null;

/** One feedback line under a card's button, cleared after a while. */
function useFlash(): [Flash, (f: Flash) => void] {
  const [flash, setFlash] = useState<Flash>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (f: Flash) => {
    setFlash(f);
    if (timer.current) clearTimeout(timer.current);
    if (f) timer.current = setTimeout(() => setFlash(null), 6000);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return [flash, set];
}

function FlashLine({ flash }: { flash: Flash }) {
  if (!flash) return <p class="m-flash" aria-live="polite" />;
  return (
    <p class={`m-flash is-${flash.kind}`} aria-live="polite">
      {flash.kind === 'ok' ? '✓ ' : ''}
      {flash.text}
    </p>
  );
}

function Card({ id, emoji, title, children }: { id: string; emoji: string; title: string; children: preact.ComponentChildren }) {
  return (
    <section class="m-card" aria-labelledby={id}>
      <h2 id={id} class="m-h2">
        <span aria-hidden="true">{emoji}</span> {title}
      </h2>
      {children}
    </section>
  );
}

function MessageCard({ st, onLost }: { st: MemberState; onLost: (e: unknown) => boolean }) {
  const [text, setText] = useState('');
  const [screens, setScreens] = useState<string[]>([]);
  const [secs, setSecs] = useState(st.durations.includes(600) ? 600 : st.durations[0]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useFlash();
  const toggle = (id: string) => setScreens((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const send = async (e: Event) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.message(text.trim(), screens, secs);
      setText('');
      setFlash({ kind: 'ok', text: t('Mensaje enviado') });
    } catch (err) {
      if (!onLost(err)) setFlash({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card id="m-msg" emoji="💬" title={t('Mensaje a las pantallas')}>
      <form onSubmit={send}>
        <textarea
          class="m-input m-textarea"
          maxLength={200}
          rows={3}
          value={text}
          placeholder={t('Por ejemplo: la cena está lista')}
          aria-label={t('Mensaje')}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        />
        {st.screens.length > 1 && (
          <div class="m-chips" role="group" aria-label={t('Pantallas')}>
            <button type="button" class={`m-chip${screens.length === 0 ? ' is-on' : ''}`} aria-pressed={screens.length === 0} onClick={() => setScreens([])}>
              {t('Todas')}
            </button>
            {st.screens.map((s) => (
              <button type="button" class={`m-chip${screens.includes(s.id) ? ' is-on' : ''}`} aria-pressed={screens.includes(s.id)} onClick={() => toggle(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div class="m-chips" role="group" aria-label={t('Cuánto tiempo')}>
          {st.durations.map((d) => (
            <button type="button" class={`m-chip${secs === d ? ' is-on' : ''}`} aria-pressed={secs === d} onClick={() => setSecs(d)}>
              {minutesLabel(d)}
            </button>
          ))}
        </div>
        <button type="submit" class="m-btn m-btn-primary" disabled={busy || !text.trim()}>
          {busy ? t('Enviando…') : t('Enviar')}
        </button>
      </form>
      <FlashLine flash={flash} />
    </Card>
  );
}

function PrivacyCard({ st, onLost, onChange }: { st: MemberState; onLost: (e: unknown) => boolean; onChange: (p: { on: number; total: number }) => void }) {
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useFlash();
  const p = st.privacy ?? { on: 0, total: 0 };
  const run = async (mode: 'on' | 'off') => {
    setBusy(mode);
    try {
      const r = await api.privacy(mode);
      onChange(r.privacy);
      setFlash({ kind: 'ok', text: mode === 'on' ? t('Modo privado activado') : t('Modo privado desactivado') });
    } catch (err) {
      if (!onLost(err)) setFlash({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy('');
    }
  };
  return (
    <Card id="m-priv" emoji="🔒" title={t('Modo privado')}>
      <p class="m-muted">
        {p.on === 0 ? t('Ahora no hay ninguna pantalla en modo privado.') : p.on === p.total ? t('Todas las pantallas están en modo privado.') : t('{on} de {total} pantallas en modo privado.', { on: p.on, total: p.total })}
      </p>
      <div class="m-row">
        <button type="button" class={`m-btn${p.on === p.total && p.total ? ' is-current' : ''}`} disabled={!!busy} onClick={() => void run('on')}>
          {t('Activar')}
        </button>
        <button type="button" class={`m-btn${p.on === 0 ? ' is-current' : ''}`} disabled={!!busy} onClick={() => void run('off')}>
          {t('Desactivar')}
        </button>
      </div>
      <FlashLine flash={flash} />
    </Card>
  );
}

function NightCard({ onLost }: { onLost: (e: unknown) => boolean }) {
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useFlash();
  const run = async (mode: 'on' | 'off' | 'auto') => {
    setBusy(mode);
    try {
      await api.night(mode);
      setFlash({ kind: 'ok', text: mode === 'on' ? t('Pantallas en modo noche') : mode === 'off' ? t('Pantallas en modo día') : t('Pantallas en modo automático') });
    } catch (err) {
      if (!onLost(err)) setFlash({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy('');
    }
  };
  return (
    <Card id="m-night" emoji="🌙" title={t('Noche o día')}>
      <div class="m-row m-row-3">
        {(
          [
            ['on', '🌙', 'Noche'],
            ['off', '☀️', 'Día'],
            ['auto', '🕑', 'Auto'],
          ] as const
        ).map(([mode, emoji, label]) => (
          <button type="button" class="m-btn m-btn-stack" disabled={!!busy} onClick={() => void run(mode)}>
            <span aria-hidden="true">{emoji}</span>
            <span>{t(label)}</span>
          </button>
        ))}
      </div>
      <FlashLine flash={flash} />
    </Card>
  );
}

function TodoCard({ onLost }: { onLost: (e: unknown) => boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useFlash();
  const add = async (e: Event) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.todo(text.trim());
      setText('');
      setFlash({ kind: 'ok', text: t('Tarea añadida') });
    } catch (err) {
      if (!onLost(err)) setFlash({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card id="m-todo" emoji="✅" title={t('Nueva tarea')}>
      <form onSubmit={add} class="m-inline">
        <input class="m-input" maxLength={200} value={text} placeholder={t('Por ejemplo: comprar pan')} aria-label={t('Tarea')} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        <button type="submit" class="m-btn m-btn-primary" disabled={busy || !text.trim()}>
          {t('Añadir')}
        </button>
      </form>
      <FlashLine flash={flash} />
    </Card>
  );
}

function EventCard({ st, onLost }: { st: MemberState; onLost: (e: unknown) => boolean }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayStr());
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('19:00');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useFlash();
  const add = async (e: Event) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await api.event({ title: title.trim(), date, allDay, ...(allDay ? {} : { startTime: start, endTime: end }) });
      setTitle('');
      const when = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`));
      setFlash({ kind: 'ok', text: t('Evento añadido: {when}', { when }) });
    } catch (err) {
      if (!onLost(err)) setFlash({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card id="m-event" emoji="📅" title={t('Nuevo evento')}>
      {!st.calendarOn && <p class="m-muted">{t('El calendario local está apagado.')}</p>}
      <form onSubmit={add} class="m-form">
        <input class="m-input" maxLength={120} value={title} placeholder={t('Por ejemplo: dentista')} aria-label={t('Título')} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        <label class="m-field">
          <span>{t('Fecha')}</span>
          <input class="m-input" type="date" value={date} required onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        </label>
        <label class="m-check">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay((e.target as HTMLInputElement).checked)} />
          <span>{t('Todo el día')}</span>
        </label>
        {!allDay && (
          <div class="m-row">
            <label class="m-field">
              <span>{t('Empieza')}</span>
              <input class="m-input" type="time" value={start} required onInput={(e) => setStart((e.target as HTMLInputElement).value)} />
            </label>
            <label class="m-field">
              <span>{t('Termina')}</span>
              <input class="m-input" type="time" value={end} onInput={(e) => setEnd((e.target as HTMLInputElement).value)} />
            </label>
          </div>
        )}
        <button type="submit" class="m-btn m-btn-primary" disabled={busy || !title.trim() || !date || !st.calendarOn}>
          {t('Añadir al calendario')}
        </button>
      </form>
      <FlashLine flash={flash} />
    </Card>
  );
}

// ---- screens ----

function CodeEntry({ onIn, notice }: { onIn: (r: MemberAuthResponse) => void; notice: string }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e?: Event) => {
    e?.preventDefault();
    if (code.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    setErr('');
    try {
      onIn(await api.pair(code));
    } catch (er) {
      setErr(errorText(er));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main class="m-page m-center">
      <span class="m-big-emoji" aria-hidden="true">
        🏠
      </span>
      <h1>{t('Tu panel de la familia')}</h1>
      {notice && <p class="m-notice">{notice}</p>}
      <p class="m-muted">{t('Pide que muestren tu código en una de las pantallas de casa y escríbelo aquí. También puedes abrir tu enlace privado.')}</p>
      <form onSubmit={submit} class="m-form">
        <input
          class="m-input m-code"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          spellcheck={false}
          maxLength={CODE_LENGTH + 2}
          value={code}
          aria-label={t('Código')}
          placeholder="ABC123"
          onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase().replace(CODE_CHARS, '').slice(0, CODE_LENGTH))}
        />
        <button type="submit" class="m-btn m-btn-primary" disabled={busy || code.length !== CODE_LENGTH}>
          {busy ? t('Comprobando…') : t('Entrar')}
        </button>
      </form>
      {err && (
        <p class="m-flash is-error" role="alert">
          {err}
        </p>
      )}
    </main>
  );
}

function Dashboard({ st, setSt, onLost, onForget }: { st: MemberState; setSt: (s: MemberState) => void; onLost: (e: unknown) => boolean; onForget: () => void }) {
  const c = st.color ? chipColors(st.color) : null;
  const any = st.can.message || st.can.privacy || st.can.night || st.can.todo || st.can.events;
  return (
    <main class="m-page">
      <header class="m-head" style={c ? ({ '--kc': st.color, '--kc-on': c.onSolid } as Record<string, string>) : undefined}>
        <span class={`m-avatar${st.color ? ' has-color' : ''}`} aria-hidden="true">
          {st.avatar || '🙂'}
        </span>
        <h1>{t('Hola, {name}', { name: st.name })}</h1>
      </header>
      {!any && <p class="m-card m-muted">{t('Todavía no tienes nada que controlar desde aquí. Pide que te den permisos en el panel.')}</p>}
      {st.can.message && st.screens.length > 0 && <MessageCard st={st} onLost={onLost} />}
      {st.can.privacy && <PrivacyCard st={st} onLost={onLost} onChange={(p) => setSt({ ...st, privacy: p })} />}
      {st.can.night && <NightCard onLost={onLost} />}
      {st.can.todo && <TodoCard onLost={onLost} />}
      {st.can.events && <EventCard st={st} onLost={onLost} />}
      <footer class="m-foot">
        <button type="button" class="m-link" onClick={onForget}>
          {t('Salir en este móvil')}
        </button>
      </footer>
    </main>
  );
}

function App() {
  const [st, setSt] = useState<MemberState | null>(null);
  const [phase, setPhase] = useState<'loading' | 'code' | 'ready'>('loading');
  const [notice, setNotice] = useState('');

  const take = (s: MemberState) => {
    setLang(s.lang);
    setSt(s);
    setPhase('ready');
  };
  const signedIn = (r: MemberAuthResponse) => {
    token = r.token;
    saveToken(r.token);
    setNotice('');
    take(r.state);
  };
  /** This phone lost its access (revoked, person deleted): back to the code screen. True when that was the error. */
  const lost = (e: unknown) => {
    if (!(e instanceof ApiError) || (e.code !== 'invalid_token' && e.code !== 'token_required')) return false;
    token = null;
    saveToken(null);
    setSt(null);
    setNotice(t('Este móvil ya no tiene acceso. Pide un código nuevo.'));
    setPhase('code');
    return true;
  };

  useEffect(() => {
    void (async () => {
      try {
        if (START.link) return signedIn(await api.redeem(START.link));
        if (START.code) return signedIn(await api.pair(START.code));
      } catch (e) {
        setNotice(errorText(e));
        if (!token) return setPhase('code');
      }
      if (!token) return setPhase('code');
      try {
        take(await api.state());
      } catch (e) {
        if (!lost(e)) {
          setNotice(errorText(e));
          setPhase('code');
        }
      }
    })();
  }, []);

  // fresh permissions when the phone comes back to the page, and every minute while it is open
  useEffect(() => {
    if (phase !== 'ready') return;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || !token) return;
      api.state().then(take).catch((e) => void lost(e));
    };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [phase]);

  const forget = async () => {
    if (!confirm(t('¿Salir en este móvil? Para volver a entrar necesitarás tu enlace o un código nuevo.'))) return;
    try {
      await api.forget();
    } catch {
      /* the token goes from this phone anyway */
    }
    token = null;
    saveToken(null);
    setSt(null);
    setNotice('');
    setPhase('code');
  };

  if (phase === 'loading') return <main class="m-page m-center" aria-busy="true"><div class="m-spinner" /></main>;
  if (phase === 'code' || !st) return <CodeEntry onIn={signedIn} notice={notice} />;
  return <Dashboard st={st} setSt={setSt} onLost={lost} onForget={() => void forget()} />;
}

setLang(initialLang());
render(<App />, document.getElementById('app')!);
