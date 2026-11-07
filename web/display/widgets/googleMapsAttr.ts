// The "Google Maps" line under travel times from Google (the commute widget, the Trayectos card). Google's terms for
// Routes and Directions content shown without a Google map ask for it: the text exactly "Google Maps", never
// translated, re-cased or cut, weight 400, 12 to 16 px, in white, #1F1F1F or #5E5E5E with at least 4.5:1 contrast,
// at the top or the bottom of the content. Its size is 1.2rem (12 px on a 1080-line screen) and never under 12 px
// where the page's rem is smaller. The colour follows the ink of the card it is on (styles: .gm-attr).

/** The attribution element: `cls` adds the place's own class. */
export function googleMapsAttr(cls = ''): HTMLElement {
  const a = document.createElement('span');
  a.className = cls ? `${cls} gm-attr` : 'gm-attr';
  a.textContent = 'Google Maps';
  a.setAttribute('translate', 'no');
  return a;
}

/** Light or dark text from a CSS colour (the card's own ink): '' when it cannot be read. */
function inkOf(color: string): 'light' | 'dark' | '' {
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(color);
  if (!m) return '';
  const lin = (v: string) => {
    const c = Number(v) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
  return l > 0.4 ? 'light' : 'dark';
}

/**
 * Marks the attribution with the ink of `from` (data-ink="dark" on light cards, which the styles turn into #1F1F1F
 * or #5E5E5E; white otherwise). Call it once both are in the page.
 */
export function inkGoogleMapsAttr(a: HTMLElement | null, from: HTMLElement): void {
  if (!a || !from.isConnected) return;
  const ink = inkOf(getComputedStyle(from).color);
  if (ink === 'dark') a.dataset.ink = 'dark';
  else delete a.dataset.ink;
}
