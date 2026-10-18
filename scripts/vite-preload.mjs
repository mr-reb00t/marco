// Vite plugin: the display page (web/index.html) asks for what its first screen needs while the browser is still
// reading the page, instead of one round trip later:
//   - <link rel="modulepreload"> for the WebGL chunks the display imports lazily (web/display/gl/*, three.js), so
//     they are not discovered only once the config has come
//   - <link rel="preload" as="font"> for the Latin subsets of Inter and Outfit, which the CSS would only reveal
//     after it is parsed
// The admin and family pages are left as they are. Marco Cloud's build (marco-cloud scripts/build-web.mjs) uses the
// same plugin.

/** Lazily imported modules of the display worth preloading: the WebGL layers. */
const LAZY = /\/web\/display\/gl\//;
/** Fonts of the first screen: the Latin subsets (Spanish, Portuguese, Dutch and Danish letters are all in it). */
const FONTS = /^(?:inter|outfit)-latin-wght-normal-[\w-]+\.woff2$/;

/** Files to preload for `entry` (an output chunk) in `bundle`: { modules: [fileName], fonts: [fileName] }. */
export function displayPreloads(bundle, entry) {
  const modules = [];
  const seen = new Set([entry.fileName, ...(entry.imports || [])]);
  const add = (name) => {
    const c = bundle[name];
    if (!c || c.type !== 'chunk' || seen.has(name)) return;
    seen.add(name);
    modules.push(name);
    for (const i of c.imports || []) add(i);
  };
  for (const name of entry.dynamicImports || []) {
    const c = bundle[name];
    if (c?.type === 'chunk' && c.facadeModuleId && LAZY.test(c.facadeModuleId.replace(/\\/g, '/'))) add(name);
  }
  const fonts = Object.values(bundle)
    .filter((a) => a.type === 'asset' && FONTS.test(a.fileName.split('/').pop()))
    .map((a) => a.fileName)
    .sort();
  return { modules, fonts };
}

export function displayPreload() {
  let base = '/';
  return {
    name: 'marco-display-preload',
    apply: 'build',
    configResolved(c) {
      base = c.base || '/';
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle || !ctx.chunk || ctx.path !== '/index.html') return html;
        const { modules, fonts } = displayPreloads(ctx.bundle, ctx.chunk);
        return [
          ...modules.map((f) => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: base + f }, injectTo: 'head' })),
          ...fonts.map((f) => ({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: true, href: base + f }, injectTo: 'head' })),
        ];
      },
    },
  };
}
