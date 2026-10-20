# Contributing to Marco

Thanks for your interest! Bug reports, ideas, translations and pull requests are all welcome.

## Getting started

```bash
git clone https://github.com/mr-reb00t/marco.git
cd marco
npm ci
npm run dev      # API on :3000 (node --watch) + Vite on :5173 → http://localhost:5173/ and /admin/
npm run demo     # or: a production build with a fictional family and sample photos
```

Requirements: Node.js 20 or newer (22 LTS recommended). No native modules and no database: data lives in JSON files.

## Before you open a pull request

```bash
npm test                 # server tests (node --test); MARCO_SKIP_BROWSER=1 npm test skips the headless Chrome ones
npx tsc --noEmit -p .    # type check (display + admin)
npm run contract         # if you changed web/admin/api.ts or web/shared/types.ts (CI checks it is up to date)
npm run build            # production build
shellcheck install.sh deploy/*.sh deploy/marco scripts/*.sh   # if you changed a shell script
```

Publishing a fork? Point the repository URLs (READMEs, `web/shared/project.ts`, `.github/`) at your fork;
`npm run check:release` fails while a repository URL placeholder is left (CI runs it for `v*` tags).

- Keep the server plain ESM JavaScript (no build step) and avoid new runtime dependencies: it has to run well on a
  Raspberry Pi. Every JSON data file is written atomically (`writeFileAtomic`).
- New server logic should come with a `node --test` test in `server/test/`.
- Logic that needs no files, network or SSE goes in `server/core/`, which Marco Cloud also runs: no Node built-ins
  (`node:*`, `Buffer`, `process`) and no imports from outside the folder. `server/test/core-lint.test.js` checks it.
- The display must never visibly reload for routine updates; animate with CSS transforms/opacity only and keep the
  WebGL layers capped (see `docs/ARCHITECTURE.md`).
- UI text: the admin uses the Spanish string as the translation key (`t('…')`) with English/Portuguese entries in
  `web/admin/i18n-dict*.ts` and Dutch, Danish and Polish entries in `web/admin/i18n-dict-nl.ts`, `i18n-dict-da.ts`
  and `i18n-dict-pl.ts` (the Familia rows in `i18n-dict-family.ts`); the display uses `web/shared/i18n.ts`;
  server-generated text uses `server/core/lib/i18n.js`. Please add all six languages when you add a string (ask for
  help in the PR if you only speak some of them; a missing Dutch, Danish or Polish value shows the English one, and
  `server/test/i18n-complete.test.js` lists what is missing). See [Adding a language](#adding-a-language).
- Writing style (docs, UI strings in every language, commit messages, script output): plain and direct. No em
  dashes (use a comma, colon, parentheses or a new sentence) and no marketing words. Say what a feature does.
- Installer changes: try `bash install.sh --dry-run` first, and keep `install.sh` working when it is piped into
  `bash` (prompts read from `/dev/tty`).
- Never put real calendar URLs, tokens, names or other personal data in tests, fixtures or screenshots.
  `npm run demo` and `/?demo=1` provide a fictional dataset for screenshots.

## Adding a language

Marco speaks Spanish, English, Portuguese, Dutch, Danish and Polish. Corrections from native speakers are very
welcome, even a single string: open an issue or a pull request with the text you would change and why. Want a new
language? Open an issue first so we can coordinate; we can do a first translation together and you review it.

Where the strings live:

| What | File |
|---|---|
| Admin (keyed by the Spanish string) | English and Portuguese rows in `web/admin/i18n-dict*.ts`; one file per further language, `web/admin/i18n-dict-nl.ts`, `-da.ts`, `-pl.ts` |
| Familia rows (admin and the family page on the phone) | `web/admin/i18n-dict-family.ts` (kept apart so the family page stays small) |
| Count forms ("1 screen", "3 screens") | `SINGULAR` in `web/admin/i18n-plural.ts` plus the language's own singular table; Polish also has a "few" table (`PL_FEW`, for 2-4, 22-24…) |
| Screen (display) | `web/shared/i18n.ts`: one dictionary per language, plus the date helpers |
| Welcome and pairing screens | `web/display/widgets/welcome.ts`, `web/display/widgets/pairing.ts` |
| Server text (weather, wind, private mode titles, backup summaries) | `server/core/lib/i18n.js` |
| Holiday names of the Google feeds | `HOLIDAYS` in `server/rules.js` |
| Icon rule keywords and emoji search words | `server/core/iconRules.js`, `web/admin/emoji-data.ts` |
| Demo data | `web/display/mock-text.ts`, `scripts/demo.js` |
| Marco Cloud pages and emails | in the Marco Cloud repository |

To add a language:

1. Add its code to `Lang` in `web/shared/types.ts` and to `LANGS`, `LOCALES` and `LANG_NAMES` in
   `web/shared/i18n.ts`, and to `LANGS` in `server/core/lib/i18n.js` (the server validates against it).
2. Create `web/admin/i18n-dict-<code>.ts` with a value for every Spanish key and register it in `MORE` in
   `web/admin/i18n.ts`; add its Familia tables to `i18n-dict-family.ts` and `web/family/i18n.ts`.
3. Add a dictionary to `web/shared/i18n.ts`, a column to the server tables, a block to the welcome and pairing
   screens, a card to the setup wizard (`web/admin/Setup.tsx`) and, if the language needs it, a date format in
   `formatDateLine`.
4. Add the language to the lists in `server/test/i18n-complete.test.js` and run it:
   `node --test server/test/i18n-complete.test.js` lists every missing string and every placeholder that does not
   match the Spanish one. The other display tests count one value per language.

Keep the `{placeholders}` exactly as in the Spanish key, write the way people talk in that language rather than word
for word, and follow the writing style above (no em dashes).

## Reporting bugs

Use the issue templates. Include the version (admin → Status, or `GET /api/health`), how you installed it, and the
display hardware/browser. Remove private data from logs and screenshots.

By contributing you agree that your contributions are licensed under the MIT License of this project.
