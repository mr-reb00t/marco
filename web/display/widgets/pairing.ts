// Private display access (docs/API.md "Display access"): a display that has no valid key shows
//   - 'pair':    "Pair this screen" + a code (6 characters self-hosted, pairCodeLength in /api/health) + QR to
//                /admin/#pair=<code> (private mode, no key yet)
//   - 'invalid': "This link is no longer valid" (regenerated link / revoked device) + the same pairing code
// and never any family data. The page polls /api/pair/status with the secret session id every ~2 s; once an admin
// claims the code it stores the device token and starts normally.
import { logoSvg } from '../../shared/logo';
import { qrSvg } from '../../shared/qr';
import type { HealthResponse, Lang, PairStartResponse, PairStatusResponse } from '../../shared/types';
import { LANGS, LOCALES } from '../../shared/i18n';
import { healthOnce } from '../health';
import { clearCaches, saveDeviceToken } from '../identity';

const TEXT: Record<Lang, Record<string, string>> = {
  en: {
    pairTitle: 'Pair this screen',
    pairLead: 'This screen is private. Link it to your Marco from your phone or computer:',
    invalidTitle: 'This link is no longer valid',
    invalidLead: 'Its private link was replaced or this device was removed. Open the admin to get the new link, or pair this screen again:',
    s1: 'Open the admin → Connected screens → Pair a screen',
    s1At: 'Open {where} → Connected screens → Pair a screen',
    s2: 'Type this code or scan the QR',
    s3: 'This screen starts by itself',
    expires: 'The code changes in {t}',
    renewing: 'Getting a new code…',
    busy: 'Too many pairing requests. Trying again in a minute…',
    offline: 'Cannot reach the server. Retrying…',
    paired: 'Paired! Starting…',
    scan: 'Scan with the phone where you use the admin',
    kiosk: 'Raspberry Pi kiosk? It forgets a pairing when it restarts: put the screen’s private link in KIOSK_URL (~/.config/marco/kiosk.env) instead.',
  },
  es: {
    pairTitle: 'Vincula esta pantalla',
    pairLead: 'Esta pantalla es privada. Vincúlala a tu Marco desde el móvil o el ordenador:',
    invalidTitle: 'Este enlace ya no es válido',
    invalidLead: 'Su enlace privado se ha cambiado o este dispositivo se ha quitado. Abre el panel para obtener el enlace nuevo o vuelve a vincular esta pantalla:',
    s1: 'Abre el panel → Pantallas conectadas → Vincular una pantalla',
    s1At: 'Abre {where} → Pantallas conectadas → Vincular una pantalla',
    s2: 'Escribe este código o escanea el QR',
    s3: 'Esta pantalla arranca sola',
    expires: 'El código cambia en {t}',
    renewing: 'Pidiendo un código nuevo…',
    busy: 'Demasiadas solicitudes de vinculación. Se reintenta en un minuto…',
    offline: 'No se puede conectar con el servidor. Reintentando…',
    paired: '¡Vinculada! Arrancando…',
    scan: 'Escanéalo con el móvil donde usas el panel',
    kiosk: '¿Kiosco Raspberry Pi? Olvida la vinculación al reiniciarse: pon el enlace privado de la pantalla en KIOSK_URL (~/.config/marco/kiosk.env).',
  },
  pt: {
    pairTitle: 'Emparelha este ecrã',
    pairLead: 'Este ecrã é privado. Liga-o ao teu Marco a partir do telemóvel ou do computador:',
    invalidTitle: 'Esta ligação já não é válida',
    invalidLead: 'A ligação privada foi substituída ou este dispositivo foi removido. Abre o painel para obter a nova ligação ou volta a emparelhar este ecrã:',
    s1: 'Abre o painel → Ecrãs ligados → Emparelhar um ecrã',
    s1At: 'Abre {where} → Ecrãs ligados → Emparelhar um ecrã',
    s2: 'Escreve este código ou lê o QR',
    s3: 'Este ecrã arranca sozinho',
    expires: 'O código muda em {t}',
    renewing: 'A pedir um código novo…',
    busy: 'Demasiados pedidos de emparelhamento. Nova tentativa dentro de um minuto…',
    offline: 'Não é possível ligar ao servidor. A tentar de novo…',
    paired: 'Emparelhado! A arrancar…',
    scan: 'Lê com o telemóvel onde usas o painel',
    kiosk: 'Quiosque Raspberry Pi? Esquece o emparelhamento ao reiniciar: põe a ligação privada do ecrã em KIOSK_URL (~/.config/marco/kiosk.env).',
  },
  nl: {
    pairTitle: 'Koppel dit scherm',
    pairLead: 'Dit scherm is privé. Koppel het aan je Marco vanaf je telefoon of computer:',
    invalidTitle: 'Deze link is niet meer geldig',
    invalidLead: 'De privélink is vervangen of dit apparaat is verwijderd. Open het beheer voor de nieuwe link, of koppel dit scherm opnieuw:',
    s1: 'Open het beheer → Verbonden schermen → Scherm koppelen',
    s1At: 'Open {where} → Verbonden schermen → Scherm koppelen',
    s2: 'Typ deze code of scan de QR-code',
    s3: 'Dit scherm start vanzelf',
    expires: 'De code verandert over {t}',
    renewing: 'Nieuwe code ophalen…',
    busy: 'Te veel koppelverzoeken. Over een minuut opnieuw proberen…',
    offline: 'Kan de server niet bereiken. Opnieuw proberen…',
    paired: 'Gekoppeld! Starten…',
    scan: 'Scan met de telefoon waarop je het beheer gebruikt',
    kiosk: 'Raspberry Pi-kiosk? Die vergeet de koppeling bij een herstart: zet de privélink van het scherm in KIOSK_URL (~/.config/marco/kiosk.env).',
  },
  da: {
    pairTitle: 'Par denne skærm',
    pairLead: 'Denne skærm er privat. Par den med din Marco fra din telefon eller computer:',
    invalidTitle: 'Dette link virker ikke længere',
    invalidLead: 'Det private link er blevet skiftet, eller enheden er fjernet. Åbn adminpanelet for at få det nye link, eller par skærmen igen:',
    s1: 'Åbn adminpanelet → Forbundne skærme → Par en skærm',
    s1At: 'Åbn {where} → Forbundne skærme → Par en skærm',
    s2: 'Skriv denne kode, eller scan QR-koden',
    s3: 'Skærmen starter af sig selv',
    expires: 'Koden skifter om {t}',
    renewing: 'Henter en ny kode…',
    busy: 'For mange parringsforsøg. Prøver igen om et minut…',
    offline: 'Kan ikke få forbindelse til serveren. Prøver igen…',
    paired: 'Parret! Starter…',
    scan: 'Scan med den telefon, du bruger til adminpanelet',
    kiosk: 'Raspberry Pi-kiosk? Den glemmer parringen ved genstart: læg i stedet skærmens private link i KIOSK_URL (~/.config/marco/kiosk.env).',
  },
  pl: {
    pairTitle: 'Sparuj ten ekran',
    pairLead: 'Ten ekran jest prywatny. Połącz go ze swoim Marco z telefonu lub komputera:',
    invalidTitle: 'Ten link jest już nieważny',
    invalidLead: 'Prywatny link został zmieniony lub to urządzenie usunięto. Otwórz panel, aby dostać nowy link, albo sparuj ten ekran ponownie:',
    s1: 'Otwórz panel → Połączone ekrany → Sparuj ekran',
    s1At: 'Otwórz {where} → Połączone ekrany → Sparuj ekran',
    s2: 'Wpisz ten kod lub zeskanuj kod QR',
    s3: 'Ten ekran uruchomi się sam',
    expires: 'Kod zmieni się za {t}',
    renewing: 'Pobieranie nowego kodu…',
    busy: 'Zbyt wiele prób parowania. Ponowna próba za minutę…',
    offline: 'Brak połączenia z serwerem. Ponawianie…',
    paired: 'Sparowano! Uruchamianie…',
    scan: 'Zeskanuj telefonem, na którym używasz panelu',
    kiosk: 'Kiosk Raspberry Pi? Zapomina parowanie przy restarcie: zamiast tego wpisz prywatny link ekranu w KIOSK_URL (~/.config/marco/kiosk.env).',
  },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Language for a screen that has no config yet: ?lang=, else the browser's, else English. */
export function pairingLang(params = new URLSearchParams(location.search)): Lang {
  const pl = params.get('lang');
  if (LANGS.includes(pl as Lang)) return pl as Lang;
  try {
    for (const l of navigator.languages ?? [navigator.language]) {
      const b = String(l).slice(0, 2).toLowerCase();
      if (LANGS.includes(b as Lang)) return b as Lang;
    }
  } catch { /* ignore */ }
  return 'en';
}

let root: HTMLElement | null = null;
let running = false;

async function post<T>(url: string, body: unknown): Promise<{ status: number; json: T | null }> {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: 'POST', cache: 'no-store', signal: ctl.signal,
      headers: { 'content-type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body ?? {}),
    });
    let json: T | null = null;
    try {
      json = (await r.json()) as T;
    } catch { /* not JSON */ }
    return { status: r.status, json };
  } finally {
    clearTimeout(tm);
  }
}

/**
 * Started by deploy/kiosk.sh (it adds ?client=<hostname>; Chromium runs --incognito there, so a device token is
 * lost on every restart): the pairing screen says to use the private link in KIOSK_URL instead.
 */
const kioskHint = () => new URLSearchParams(location.search).has('client');

/**
 * A keyless display on the pairing screen (kicked when the admin switched to private) comes back by itself when the
 * admin switches display access back to open (or an admin session appears): probe the display config now and then.
 * Not on /pair (that page shows a code on purpose, also in open mode) nor on the invalid-link screen.
 */
const PROBE_MS = 30_000;
function probeAccess(kind: 'pair' | 'invalid'): void {
  if (kind !== 'pair' || location.pathname === '/pair' || probing) return;
  probing = true;
  setInterval(async () => {
    try {
      const r = await fetch(`/api/display/config${location.search}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (r.status === 200) location.reload();
    } catch { /* offline: keep showing the code */ }
  }, PROBE_MS);
}
let probing = false;

/** "ABC234" → "ABC 234", "ABCD2345" → "ABCD 2345". */
export const fmtCode = (c: string) => {
  const half = Math.ceil(c.length / 2);
  return `${c.slice(0, half)} ${c.slice(half)}`;
};

/** Placeholder shown until the first code arrives, as long as the server's codes. */
export const codePlaceholder = (length: number) => fmtCode('·'.repeat(Math.min(12, Math.max(4, length || 6))));

type PairHealth = Pick<HealthResponse, 'edition' | 'pairCodeLength' | 'lanAddresses' | 'adminOrigin'>;

/** GET /api/health once (pairing code length, LAN addresses for a kiosk on localhost, admin origin). {} offline. */
export const pairHealth = (): Promise<PairHealth> => healthOnce();

const isLocalHost = (host: string) => /^(localhost|127\.|\[::1\])/.test(host);

/**
 * Where people open the admin to pair this screen. `where` is shown in the steps ("192.168.1.20:3000/admin"), `url`
 * is the QR target base. On a kiosk opened on http://localhost the server's LAN address is used instead (from
 * health.lanAddresses), and a display served from its own origin (Marco Cloud) points at health.adminOrigin.
 * where = '' when nothing better than "localhost" is known.
 */
export function adminTarget(h: PairHealth, loc: { protocol: string; host: string; hostname: string; port: string; origin: string } = location): { where: string; url: string } {
  let origin = loc.origin;
  if (typeof h.adminOrigin === 'string' && /^https?:\/\//.test(h.adminOrigin)) {
    try {
      origin = new URL(h.adminOrigin).origin;
    } catch { /* keep this origin */ }
  } else if (isLocalHost(loc.hostname)) {
    const ip = Array.isArray(h.lanAddresses) ? h.lanAddresses.find((a) => typeof a === 'string' && /^[0-9a-f.:]+$/i.test(a)) : undefined;
    if (!ip) return { where: '', url: `${loc.origin}/admin/` };
    const host = ip.includes(':') ? `[${ip}]` : ip;
    origin = `${loc.protocol}//${host}${loc.port ? `:${loc.port}` : ''}`;
  }
  return { where: `${new URL(origin).host}/admin`, url: `${origin}/admin/` };
}

/**
 * Path of the display page once paired, keeping ?client= & co. and dropping a dead /d/<key>: a page opened at /pair
 * stays there, and so does every display of a server where "/" is not the display (Marco Cloud).
 */
export function afterPairUrl(h: Pick<HealthResponse, 'edition'> = {}, loc: { pathname: string; search: string } = location): string {
  const q = new URLSearchParams(loc.search);
  q.delete('k');
  const s = q.toString();
  const home = loc.pathname === '/pair' || (h.edition != null && h.edition !== 'self-hosted') ? '/pair' : '/';
  return `${home}${s ? `?${s}` : ''}`;
}

/** Sets the code text and its length (the CSS sizes the code so it always fits its column). */
function setCode(el: HTMLElement, text: string): void {
  el.textContent = text;
  (el.parentElement ?? el).style.setProperty('--chars', String(Math.max(4, text.length)));
}

/** Code shown by the preview (?demo=1&pair=1|invalid&pairLen=6|8): no server, no polling. */
const DEMO_CODE = 'K7M3QXWD';

/**
 * Full-screen pairing / invalid-link screen. Returns to the dashboard by reloading: once paired, or (keyless
 * pairing screen) when display access is open again. `demo` = a static preview with a sample code.
 */
export function showPairing(kind: 'pair' | 'invalid', lang: Lang, demo?: { length: number }): void {
  const T = TEXT[lang] ?? TEXT.en;
  clearCaches();
  document.documentElement.classList.add('needs-setup', 'needs-pairing');
  root ??= document.body.appendChild(document.createElement('div'));
  root.id = 'welcome';
  root.className = `wl--pair wl--${kind}`;
  root.setAttribute('role', 'dialog');
  const title = kind === 'invalid' ? T.invalidTitle : T.pairTitle;
  root.setAttribute('aria-label', title);
  root.innerHTML = `
    <div class="wl-bg" aria-hidden="true"><span class="wl-blob wl-blob--a"></span><span class="wl-blob wl-blob--b"></span><span class="wl-blob wl-blob--c"></span></div>
    <div class="wl-card">
      <div class="wl-main">
        <div class="wl-brand">${logoSvg('wl-logo')}Marco</div>
        ${kind === 'invalid' ? '<div class="wl-badge" aria-hidden="true">!</div>' : ''}
        <h1>${esc(title)}</h1>
        <p class="wl-lead">${esc(kind === 'invalid' ? T.invalidLead : T.pairLead)}</p>
        <div class="wl-code" aria-live="polite"><span class="wl-code__txt">··· ···</span></div>
        <ol class="wl-steps">
          <li class="wl-step1"><span>1</span>${esc(T.s1)}</li>
          <li><span>2</span>${esc(T.s2)}</li>
          <li><span>3</span>${esc(T.s3)}</li>
        </ol>
        <p class="wl-note wl-status"></p>
        ${kioskHint() ? `<p class="wl-note wl-kiosk">${esc(T.kiosk)}</p>` : ''}
      </div>
      <div class="wl-qr"><div class="wl-qr__img"></div><span>${esc(T.scan)}</span></div>
    </div>
    <div class="wl-clock" aria-hidden="true"></div>`;
  const loc = LOCALES[lang];
  const clock = root.querySelector('.wl-clock') as HTMLElement;
  const tick = () => {
    clock.textContent = new Date().toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 10_000);
  const codeEl = root.querySelector('.wl-code__txt') as HTMLElement;
  if (demo) {
    const code = DEMO_CODE.slice(0, Math.min(DEMO_CODE.length, Math.max(4, demo.length || 6)));
    setCode(codeEl, fmtCode(code));
    const url = `${location.origin}/admin/#pair=${code}`;
    try {
      (root.querySelector('.wl-qr__img') as HTMLElement).innerHTML = qrSvg(url, { dark: '#0b0d11', light: '#ffffff', title: url });
    } catch { /* no QR */ }
    (root.querySelector('.wl-status') as HTMLElement).textContent = T.expires.replace('{t}', '9:41');
    return;
  }
  setCode(codeEl, codeEl.textContent || '');
  void pairHealth().then((h) => {
    if (/^[· ]+$/.test(codeEl.textContent || '')) setCode(codeEl, codePlaceholder(Number(h.pairCodeLength) || 6));
    const where = adminTarget(h).where;
    const text = root?.querySelector('.wl-step1')?.lastChild;
    if (text && where) text.textContent = T.s1At.replace('{where}', where);
  });
  if (!running) {
    running = true;
    void pairLoop(T);
  }
  probeAccess(kind);
}

async function pairLoop(T: Record<string, string>): Promise<void> {
  const el = root!;
  const codeEl = el.querySelector('.wl-code__txt') as HTMLElement;
  const qrEl = el.querySelector('.wl-qr__img') as HTMLElement;
  const statusEl = el.querySelector('.wl-status') as HTMLElement;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let countdown: ReturnType<typeof setInterval> | null = null;
  for (;;) {
    let start: { status: number; json: PairStartResponse | null };
    try {
      start = await post<PairStartResponse>('/api/pair/start', {});
    } catch {
      statusEl.textContent = T.offline;
      await wait(5000);
      continue;
    }
    if (start.status !== 200 || !start.json?.code) {
      statusEl.textContent = start.status === 429 || start.status === 503 ? T.busy : T.offline;
      await wait(start.status === 429 || start.status === 503 ? 60_000 : 5000);
      continue;
    }
    const s = start.json;
    setCode(codeEl, fmtCode(s.code));
    el.querySelector('.wl-code')!.setAttribute('aria-label', s.code.split('').join(' '));
    const adminUrl = `${adminTarget(await pairHealth()).url}#pair=${s.code}`;
    try {
      qrEl.innerHTML = qrSvg(adminUrl, { dark: '#0b0d11', light: '#ffffff', title: adminUrl });
    } catch {
      qrEl.innerHTML = '';
    }
    const expiresAt = Date.parse(s.expiresAt) || Date.now() + 600_000;
    const showLeft = () => {
      const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      statusEl.textContent = T.expires.replace('{t}', `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
    };
    if (countdown) clearInterval(countdown);
    showLeft();
    countdown = setInterval(showLeft, 1000);
    // Poll with the secret session id (never the code) until paired or expired.
    let renew = false;
    while (!renew) {
      await wait(Math.max(1000, s.pollMs || 2000));
      let st: { status: number; json: PairStatusResponse | null };
      try {
        st = await post<PairStatusResponse>('/api/pair/status', { sessionId: s.sessionId });
      } catch {
        continue; // server restarting: keep trying until the code expires
      }
      const j = st.json;
      if (j?.status === 'paired' && j.token) {
        if (countdown) clearInterval(countdown);
        saveDeviceToken(j.token);
        clearCaches();
        codeEl.textContent = '✓';
        statusEl.textContent = T.paired;
        el.classList.add('is-paired');
        const h = await pairHealth();
        setTimeout(() => location.replace(afterPairUrl(h)), 900);
        return;
      }
      if (st.status === 404 || j?.status === 'expired' || Date.now() > expiresAt) {
        statusEl.textContent = T.renewing;
        renew = true;
      }
    }
  }
}
