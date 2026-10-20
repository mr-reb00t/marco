// Family access (#16): the code a person types on their phone at /my, drawn on this screen for two minutes when the
// admin asks for it (live event / poll command `access-code`). It sits above the night layer and the announcements,
// with a QR code that opens /my with the code already filled in (in the fragment, so it never reaches a server log).
// The code is single use and short lived; the display never gets the phone's token.
import type { AccessCodePayload } from '../../shared/types';
import { qrSvg } from '../../shared/qr';
import { ctx } from '../ctx';
import { esc, reducedMotion } from '../dom';
import { serverNow } from './alerts';

/** "ABC234" → "ABC 234": two groups read better from across the room. */
export const groupCode = (code: string) => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code);

/** The address the QR code opens: the dashboard with the code in the fragment ('' without an address). */
export const accessQrUrl = (p: Pick<AccessCodePayload, 'url' | 'code'>) => (/^https?:\/\//.test(p.url) ? `${p.url}#code=${encodeURIComponent(p.code)}` : '');

/** Milliseconds the code still has on this screen (at least 5 s, at most 2 minutes). */
export function remainingMs(expiresAt: string, now: number): number {
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return 0;
  return Math.min(120_000, end - now);
}

export class AccessCodeOverlay {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private root: HTMLElement) {}

  show(p: AccessCodePayload): void {
    const code = typeof p.code === 'string' ? p.code.trim() : '';
    const left = remainingMs(p.expiresAt, serverNow());
    if (!/^[A-Z0-9]{4,12}$/.test(code) || left < 5000) return;
    const { t } = ctx;
    const qr = accessQrUrl(p);
    const where = qr ? p.url.replace(/^https?:\/\//, '') : '';
    this.root.innerHTML = `<div class="ac-card">
        <div class="ac-kicker">${esc(t('accessCodeFor', { name: p.name || '' }))}</div>
        <div class="ac-body">
          <div class="ac-main">
            <div class="ac-code" aria-label="${esc(code.split('').join(' '))}">${esc(groupCode(code))}</div>
            <div class="ac-hint">${esc(where ? t('accessCodeHint', { url: where }) : t('accessCodeHintNoUrl'))}</div>
          </div>
          ${qr ? `<div class="ac-qr">${qrSvg(qr, { dark: '#0b0d11', light: '#ffffff', title: t('accessCodeScan') })}<span>${esc(t('accessCodeScan'))}</span></div>` : ''}
        </div>
        <div class="ac-bar"><i></i></div>
      </div>`;
    this.root.classList.add('show');
    this.root.setAttribute('aria-hidden', 'false');
    const bar = this.root.querySelector('.ac-bar i') as HTMLElement | null;
    if (bar && !reducedMotion()) bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: left, easing: 'linear', fill: 'forwards' });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), left);
  }

  hide(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.root.classList.remove('show');
    this.root.setAttribute('aria-hidden', 'true');
    // the code is single use and short lived: nothing of it stays in the page
    this.root.innerHTML = '';
  }
}
