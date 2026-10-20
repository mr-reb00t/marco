import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain ESM helper without types
import { displayPreload } from './scripts/vite-preload.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

/** The CHANGELOG.md section of this version ('' when there is none), for the admin's "What's new" on Marco Cloud. */
function changelogSection(version: string): string {
  let lines: string[];
  try {
    lines = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8').split('\n');
  } catch {
    return '';
  }
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return '';
  let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).filter((l) => !/^\[[^\]]+\]: /.test(l)).join('\n').trim();
}

// Multi-page build: / -> display (Raspberry Pi screen), /admin/ -> management panel, /f/<key> -> family page (phone),
// /my/<link> -> a person's own dashboard (phone, family access).
export default defineConfig({
  root: 'web',
  plugins: [
    preact(),
    // the display page preloads its WebGL chunks and first fonts (scripts/vite-preload.mjs)
    displayPreload(),
    // Dev server only: /f and /f/<key> open the family page, /my and /my/<link> the dashboard of a person, as the
    // Express server does in production (app.js).
    {
      name: 'family-page-dev',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url && /^\/f(\/[^/?#]*)?\/?(\?.*)?$/.test(req.url)) req.url = '/family/index.html';
          else if (req.url && /^\/my(\/[^/?#]*)?\/?(\?.*)?$/.test(req.url)) req.url = '/member/index.html';
          next();
        });
      },
    },
  ],
  // Build identity reported by displays (docs/ARCHITECTURE.md), declared in web/shared/env.d.ts.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(new Date().toISOString()),
    // Only read by web/admin/whatsNewNotes.ts, a chunk the admin loads on Marco Cloud only.
    __APP_NOTES__: JSON.stringify(changelogSection(pkg.version)),
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    // The HEIC decoder (heic-to, ~3 MB) is its own lazily imported chunk, loaded only when a HEIC photo is picked.
    chunkSizeWarningLimit: 3300,
    rollupOptions: {
      input: {
        display: resolve(root, 'web/index.html'),
        admin: resolve(root, 'web/admin/index.html'),
        family: resolve(root, 'web/family/index.html'),
        member: resolve(root, 'web/member/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/auth': { target: 'http://localhost:3000', changeOrigin: false },
      '/media': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
});
