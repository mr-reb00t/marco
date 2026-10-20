// Fresh install (server needs setup): a welcome screen with the admin URL + QR code instead of an empty dashboard.
// Polls /api/setup/status and reloads the page as soon as the wizard is completed in the admin.
import { logoSvg } from '../../shared/logo';
import { qrSvg } from '../../shared/qr';
import type { Lang, SetupStatus } from '../../shared/types';
import { LOCALES } from '../../shared/i18n';

const TEXT: Record<Lang, Record<string, string>> = {
  en: {
    hello: 'Welcome',
    ready: 'This screen is ready. Finish the setup from your phone or computer:',
    s1: 'Scan the code or open the address',
    s2: 'Create the admin password and pick your calendars',
    s3: 'This screen updates by itself',
    code: 'Asked for a setup code? It is in the server log.',
    local: 'On another device, replace “localhost” with this computer’s address.',
    scan: 'Scan to set up',
  },
  es: {
    hello: 'Bienvenido',
    ready: 'Esta pantalla está lista. Termina la configuración desde el móvil o el ordenador:',
    s1: 'Escanea el código o abre la dirección',
    s2: 'Crea la contraseña del panel y elige tus calendarios',
    s3: 'Esta pantalla se actualiza sola',
    code: '¿Te pide un código de configuración? Está en el registro del servidor.',
    local: 'En otro dispositivo, cambia «localhost» por la dirección de este ordenador.',
    scan: 'Escanea para configurar',
  },
  pt: {
    hello: 'Bem-vindo',
    ready: 'Este ecrã está pronto. Termina a configuração no telemóvel ou no computador:',
    s1: 'Lê o código ou abre o endereço',
    s2: 'Cria a palavra-passe do painel e escolhe os teus calendários',
    s3: 'Este ecrã atualiza-se sozinho',
    code: 'Pede um código de configuração? Está no registo do servidor.',
    local: 'Noutro dispositivo, troca «localhost» pelo endereço deste computador.',
    scan: 'Lê para configurar',
  },
  nl: {
    hello: 'Welkom',
    ready: 'Dit scherm is klaar. Rond het instellen af op je telefoon of computer:',
    s1: 'Scan de code of open het adres',
    s2: 'Maak een wachtwoord voor het beheer en kies je agenda\'s',
    s3: 'Dit scherm werkt zichzelf bij',
    code: 'Vraagt hij om een installatiecode? Die staat in het serverlogboek.',
    local: 'Op een ander apparaat vervang je “localhost” door het adres van deze computer.',
    scan: 'Scan om in te stellen',
  },
  da: {
    hello: 'Velkommen',
    ready: 'Skærmen er klar. Gør opsætningen færdig fra din telefon eller computer:',
    s1: 'Scan koden, eller åbn adressen',
    s2: 'Opret adgangskoden til adminpanelet, og vælg dine kalendere',
    s3: 'Skærmen opdaterer sig selv',
    code: 'Bliver du bedt om en opsætningskode? Den står i serverens log.',
    local: 'På en anden enhed skal du skrive denne computers adresse i stedet for “localhost”.',
    scan: 'Scan for at komme i gang',
  },
  pl: {
    hello: 'Witaj',
    ready: 'Ten ekran jest gotowy. Dokończ konfigurację na telefonie lub komputerze:',
    s1: 'Zeskanuj kod lub otwórz adres',
    s2: 'Utwórz hasło panelu i wybierz kalendarze',
    s3: 'Ten ekran odświeży się sam',
    code: 'Pojawia się prośba o kod konfiguracji? Znajdziesz go w dzienniku serwera.',
    local: 'Na innym urządzeniu zamień „localhost” na adres tego komputera.',
    scan: 'Zeskanuj, aby skonfigurować',
  },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/**
 * Admin URL a phone can open: the page's own origin, or this machine's LAN address when the kiosk uses localhost.
 * The server leaves out Docker/bridge/VPN interfaces and sends nothing from inside a container (LAN_ADDRESS
 * overrides): then the page's own origin is shown with a hint to replace "localhost".
 */
export function adminUrlFor(status: SetupStatus, loc: Location = location): string {
  const local = /^(localhost|127\.|\[::1\]$)/.test(loc.hostname);
  const ip = local ? status.lanAddresses?.[0] : undefined;
  const origin = ip ? `${loc.protocol}//${ip}${loc.port ? `:${loc.port}` : ''}` : loc.origin;
  return `${origin}/admin/`;
}

const isLocalUrl = (u: string) => /^https?:\/\/(localhost|127\.|\[::1\])/.test(u);

let el: HTMLElement | null = null;

export function showWelcome(status: SetupStatus, lang: Lang): void {
  const T = TEXT[lang] ?? TEXT.en;
  const url = adminUrlFor(status);
  let qr = '';
  try {
    qr = qrSvg(url, { dark: '#0b0d11', light: '#ffffff', title: url });
  } catch {
    /* no QR */
  }
  el ??= document.body.appendChild(document.createElement('div'));
  el.id = 'welcome';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', T.hello);
  el.innerHTML = `
    <div class="wl-bg" aria-hidden="true"><span class="wl-blob wl-blob--a"></span><span class="wl-blob wl-blob--b"></span><span class="wl-blob wl-blob--c"></span></div>
    <div class="wl-card">
      <div class="wl-main">
        <div class="wl-brand">${logoSvg('wl-logo')}Marco</div>
        <h1>${esc(T.hello)}</h1>
        <p class="wl-lead">${esc(T.ready)}</p>
        <div class="wl-url">${esc(url)}</div>
        <ol class="wl-steps">
          <li><span>1</span>${esc(T.s1)}</li>
          <li><span>2</span>${esc(T.s2)}</li>
          <li><span>3</span>${esc(T.s3)}</li>
        </ol>
        ${isLocalUrl(url) ? `<p class="wl-note">${esc(T.local)}</p>` : ''}
        <p class="wl-note">${esc(T.code)}</p>
      </div>
      ${qr ? `<div class="wl-qr"><div class="wl-qr__img">${qr}</div><span>${esc(T.scan)}</span></div>` : ''}
    </div>
    <div class="wl-clock" aria-hidden="true"></div>`;
  const loc = LOCALES[lang] ?? 'en-GB';
  const clock = el.querySelector('.wl-clock') as HTMLElement;
  const tick = () => {
    clock.textContent = new Date().toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 10_000);
  document.documentElement.classList.add('needs-setup');
}

/**
 * GET /api/setup/status. Resolves to the status when the server needs setup (→ caller shows the welcome screen
 * and stops there), or null otherwise (normal dashboard; also on errors / old servers without the endpoint).
 */
export async function checkSetup(): Promise<SetupStatus | null> {
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('/api/setup/status', { cache: 'no-store', signal: ctl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(tm);
    if (!r.ok) return null;
    const s = (await r.json()) as SetupStatus;
    return s && s.needsSetup === true ? s : null;
  } catch {
    return null;
  }
}

/** While the welcome screen is up: reload once the wizard has been completed. */
export function waitForSetup(everyMs = 5000): void {
  const poll = async () => {
    try {
      const r = await fetch('/api/setup/status', { cache: 'no-store' });
      if (r.ok && (await r.json()).needsSetup === false) return location.reload();
    } catch {
      /* server restarting: keep waiting */
    }
    setTimeout(poll, everyMs);
  };
  setTimeout(poll, everyMs);
}
