#!/usr/bin/env node
// Generates web/shared/adminContract.json: every HTTP call the admin makes (web/admin/api.ts), with its method,
// path, query keys, the feature that gates it, the request type and the top-level keys of the response type
// (web/shared/types.ts). Self-hosted Marco and Marco Cloud both test their routes against this file, so the two
// servers cannot drift apart without a failing test.
//
//   node scripts/gen-contract.mjs           write the file
//   node scripts/gen-contract.mjs --check   exit 1 when the file is out of date
//
// The parser only understands the shapes api.ts uses (request<T>('METHOD', url, body?, opts?) and
// xhrUpload); a call it cannot read stops the script with an error instead of being left out.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTRACT_PATH = resolve(root, 'web/shared/adminContract.json');
const API_PATH = resolve(root, 'web/admin/api.ts');
const TYPES_PATH = resolve(root, 'web/shared/types.ts');

/** Feature that gates each path (first match wins); null = available in every edition. */
const FEATURE_RULES = [
  [/^\/api\/setup\//, 'setupWizard'],
  [/^\/api\/auth\/login$/, 'passwordLogin'],
  [/^\/api\/(admin\/2fa(\/|$)|auth\/2fa$)/, 'twoFactor'],
  [/^\/api\/admin\/password$/, 'passwordLogin'],
  [/^\/api\/admin\/(homeassistant\/|test\/homeassistant$)/, 'homeassistant'],
  [/^\/api\/admin\/(prices\/|test\/prices$)/, 'priceWidgets'],
  [/^\/api\/admin\/(immich\/|test\/immich$)/, 'immich'],
  [/^\/api\/admin\/test\/rss$/, 'news'],
  [/^\/api\/admin\/google\//, 'googleCalendar'],
  [/^\/api\/admin\/microsoft\//, 'microsoftCalendar'],
  [/^\/api\/admin\/photos/, 'gallery'],
  [/^\/api\/admin\/values/, 'valueHooks'],
  [/^\/api\/admin\/tokens/, 'apiTokens'],
  [/^\/api\/admin\/backups/, 'backups'],
  [/^\/api\/admin\/(export|import\/)/, 'importExport'],
  [/^\/api\/admin\/activity$/, 'activity'],
  [/^\/api\/admin\/status$/, 'status'],
  [/^\/api\/admin\/(announce|announcements)/, 'announcements'],
  [/^\/api\/admin\/(displays\/command|refresh-displays)$/, 'displayCommands'],
  [/^\/api\/(account\/(password|two-factor|google|delete)(\/|$)|auth\/sessions(\/|$))/, 'accountSettings'],
  [/^\/api\/(account\/|admin\/household$)/, 'accountMenu'],
  [/^\/api\/admin\/update(\/|$)/, 'updates'],
  [/^\/api\/admin\/feedback$/, 'feedback'],
  [/^\/api\/admin\/privacy$/, 'privacy'],
  [/^\/api\/admin\/doorbell$/, 'doorbell'],
  [/^\/api\/admin\/(test\/widget$|widgets\/)/, 'widgets'],
  [/^\/api\/admin\/family-access(\/|$)/, 'familyAccess'],
];

const featureFor = (path) => FEATURE_RULES.find(([re]) => re.test(path))?.[1] ?? null;

// ---------------------------------------------------------------- small scanners

/** Index just past the bracket that closes the one at `open` (strings and template literals skipped). */
function matchClose(src, open) {
  const pairs = { '(': ')', '{': '}', '[': ']', '<': '>' };
  const stack = [pairs[src[open]]];
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (src.startsWith('/*', i)) {
      i = src.indexOf('*/', i + 2) + 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i);
      continue;
    }
    if (src[open] === '<') {
      // generics: only angle brackets and nested braces matter
      if (c === '<') stack.push('>');
      else if (c === '{') stack.push('}');
      else if (c === '>' || c === '}') {
        if (src[i - 1] === '=') continue; // arrow inside a type
        stack.pop();
      }
    } else if (c in pairs && c !== '<') stack.push(pairs[c]);
    else if (c === ')' || c === '}' || c === ']') stack.pop();
    if (!stack.length) return i + 1;
  }
  throw new Error(`unbalanced bracket at ${open}`);
}

function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') {
      j++;
      continue;
    }
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') {
      j = matchClose(src, j + 1) - 1;
      continue;
    }
    if (src[j] === q) return j;
  }
  throw new Error(`unterminated string at ${i}`);
}

/** Split an argument list on top-level commas. */
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') {
      const j = skipString(s, i);
      cur += s.slice(i, j + 1);
      i = j;
      continue;
    }
    if ('({['.includes(c)) depth++;
    if (')}]'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---------------------------------------------------------------- types.ts

/** Top-level keys of every `export interface` and object `export type` in types.ts ("name?" when optional). */
function parseTypes(src) {
  const types = new Map();
  const re = /export (interface|type) (\w+)(?:<[^>]*>)?\s*(?:extends ([\w\s,<>]+?))?\s*(=\s*)?\{/g;
  let m;
  while ((m = re.exec(src))) {
    const open = re.lastIndex - 1;
    const close = matchClose(src, open);
    types.set(m[2], { keys: objectKeys(src.slice(open + 1, close - 1)), extends: m[3] ? m[3].split(',').map((x) => x.trim()) : [] });
    re.lastIndex = close;
  }
  return types;
}

/** Keys of an object type body, depth 1 only. */
function objectKeys(body) {
  const keys = [];
  let depth = 0;
  let line = '';
  const flush = () => {
    const t = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
    const k = /^(readonly\s+)?['"]?([\w$-]+)['"]?(\?)?\s*:/.exec(t);
    if (k) keys.push(k[2] + (k[3] ? '?' : ''));
    line = '';
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (body.startsWith('/*', i)) {
      const end = body.indexOf('*/', i + 2);
      i = end + 1;
      continue;
    }
    if (body.startsWith('//', i)) {
      const end = body.indexOf('\n', i);
      i = end < 0 ? body.length : end;
      if (depth === 0) line += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const j = skipString(body, i);
      if (depth === 0) line += body.slice(i, j + 1);
      i = j;
      continue;
    }
    if ('{[('.includes(c)) depth++;
    if ('}])'.includes(c)) depth--;
    if (depth === 0 && (c === ';' || c === '\n' || c === ',')) {
      if (/^\s*(readonly\s+)?['"]?[\w$-]+['"]?\??\s*:/.test(line)) {
        // a member may continue on the next line (union types); flush only when it ends here
        if (c === '\n' && /[|&:]\s*$/.test(line)) continue;
        flush();
      } else line = '';
      continue;
    }
    if (depth === 0) line += c;
  }
  flush();
  return keys;
}

function keysOfType(types, name, seen = new Set()) {
  const t = types.get(name);
  if (!t || seen.has(name)) return null;
  seen.add(name);
  const base = t.extends.flatMap((b) => keysOfType(types, b.replace(/<.*$/, ''), seen) ?? []);
  return [...new Set([...base, ...t.keys])];
}

/** { response, array, keys } for a TypeScript type expression. */
function describeResponse(types, expr) {
  const e = expr.trim();
  if (/^(unknown|any|void)$/.test(e)) return { response: null, array: false, keys: null };
  if (e.startsWith('{')) return { response: 'inline', array: false, keys: objectKeys(e.slice(1, -1)) };
  const arr = /^(\w+)\[\]$/.exec(e);
  if (arr) return { response: e, array: true, keys: keysOfType(types, arr[1]) };
  if (/^\w+$/.test(e)) return { response: e, array: false, keys: keysOfType(types, e) };
  return { response: e, array: false, keys: null };
}

// ---------------------------------------------------------------- api.ts

/** URL argument → { path, query }. `${encodeURIComponent(file)}` becomes ":file"; `${q({ name })}` becomes query keys. */
function parseUrl(arg, params) {
  const s = arg.trim();
  if (s[0] === "'" || s[0] === '"') return splitQuery(s.slice(1, -1), []);
  if (s[0] !== '`') throw new Error(`cannot read URL ${s}`);
  let out = '';
  const query = [];
  const body = s.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '$' && body[i + 1] === '{') {
      const end = matchClose(body, i + 1);
      const inner = body.slice(i + 2, end - 1).trim();
      const qm = /^q\((.*)\)$/s.exec(inner);
      if (qm) query.push(...queryKeys(qm[1], params));
      else {
        const id = /(\w+)\)?$/.exec(inner.replace(/\)+$/, ''))?.[1] ?? 'param';
        out += out.includes('?') ? `<${id}>` : `:${id}`;
      }
      i = end - 1;
      continue;
    }
    out += body[i];
  }
  return splitQuery(out, query);
}

function splitQuery(url, query) {
  const [path, qs] = url.split('?');
  const keys = [...query];
  if (qs) for (const part of qs.split('&')) keys.push(part.split('=')[0]);
  return { path, query: [...new Set(keys)] };
}

function queryKeys(expr, params) {
  const e = expr.trim();
  if (e.startsWith('{')) return splitArgs(e.slice(1, -1)).map((p) => p.split(':')[0].trim());
  const typ = params[e];
  if (typ && typ.startsWith('{')) return objectKeys(typ.slice(1, -1)).map((k) => k.replace(/\?$/, ''));
  return [e];
}

/** Parameter list "a: T, b?: U" → { a: 'T', b: 'U' }. */
function parseParams(list) {
  const out = {};
  for (const p of splitArgs(list)) {
    const m = /^(\w+)\??\s*(?::\s*([\s\S]+?))?(?:\s*=\s*[\s\S]+)?$/.exec(p);
    if (m) out[m[1]] = (m[2] ?? '').trim();
  }
  return out;
}

/** Body argument → request type: a declared type name, an object shape like "{name, insecureTls?}", or null. */
function describeRequest(arg, params) {
  if (arg == null) return null;
  const e = arg.trim();
  if (e === 'undefined') return null;
  if (/^\w+$/.test(e)) return params[e] || e;
  // object literals, possibly in a conditional: keys present in every branch are required
  const objs = [];
  for (let i = 0; i < e.length; i++) {
    if (e[i] === '{') {
      const end = matchClose(e, i);
      objs.push(splitArgs(e.slice(i + 1, end - 1)).map((p) => p.split(':')[0].replace(/^\.\.\./, '').trim()).filter(Boolean));
      i = end - 1;
    }
  }
  if (!objs.length) return e;
  const all = [...new Set(objs.flat())];
  const fields = all.map((k) => (objs.every((o) => o.includes(k)) ? k : `${k}?`));
  return `{${fields.join(', ')}}`;
}

function parseApi(src, types) {
  const entries = [];
  const callRe = /\b(request|xhrUpload)(<)?/g;
  let m;
  while ((m = callRe.exec(src))) {
    if (src.slice(Math.max(0, m.index - 9), m.index).includes('function')) continue; // the helper definitions
    let i = m.index + m[1].length;
    let respType = null;
    if (m[2]) {
      const end = matchClose(src, i);
      respType = src.slice(i + 1, end - 1);
      i = end;
    }
    if (src[i] !== '(') continue;
    const close = matchClose(src, i);
    const args = splitArgs(src.slice(i + 1, close - 1));
    callRe.lastIndex = close;
    const method = /^'(GET|POST|PUT|PATCH|DELETE)'$/.exec(args[0] ?? '')?.[1];
    if (!method) throw new Error(`cannot read the method of ${src.slice(m.index, close)}`);
    // the api entry (or exported function) this call belongs to
    const before = src.slice(0, m.index);
    const ent = [...before.matchAll(/^ {2}(?:async )?(\w+)(?::\s*(?:async\s*)?\(|\()([^)]*)\)(?:\s*:\s*([^={]+?))?\s*(?:=>|\{)/gm)].pop();
    const fn = [...before.matchAll(/^export (?:async )?function (\w+)(?:<[^>]*>)?\(([\s\S]*?)\)(?:\s*:\s*([^{]+?))?\s*\{/gm)].pop();
    const owner = fn && (!ent || fn.index > ent.index) ? fn : ent;
    if (!owner) throw new Error(`no api entry for ${src.slice(m.index, close)}`);
    const params = parseParams(owner[2]);
    if (!respType || /^(any|T)$/.test(respType.trim())) {
      const ret = /Promise<(.+)>/.exec(owner[3] ?? '')?.[1];
      if (ret) respType = ret;
    }
    const { path, query } = parseUrl(args[1], params);
    const request = m[1] === 'xhrUpload' ? 'multipart/form-data' : describeRequest(args[2], params);
    entries.push({ name: owner[1], method, path, query, request, ...describeResponse(types, respType ?? 'unknown') });
  }
  // URL-only entries (downloads): name: (x) => `/api/...`
  for (const d of src.matchAll(/^ {2}(\w+):\s*\(([^)]*)\)\s*=>\s*(`\/api\/[^`]*`)/gm)) {
    const { path, query } = parseUrl(d[3], parseParams(d[2]));
    entries.push({ name: d[1], method: 'GET', path, query, request: null, response: 'download', array: false, keys: null });
  }
  return entries;
}

// ---------------------------------------------------------------- contract

export function generateContract() {
  const types = parseTypes(readFileSync(TYPES_PATH, 'utf8'));
  const calls = parseApi(readFileSync(API_PATH, 'utf8'), types);
  const byRoute = new Map();
  for (const c of calls) {
    const id = `${c.method} ${c.path}`;
    const prev = byRoute.get(id);
    if (!prev) {
      byRoute.set(id, {
        method: c.method,
        path: c.path,
        query: c.query,
        feature: featureFor(c.path),
        callers: [c.name],
        request: c.request,
        response: c.response,
        responseArray: c.array,
        responseKeys: c.keys,
      });
      continue;
    }
    prev.callers = [...new Set([...prev.callers, c.name])].sort();
    prev.query = [...new Set([...prev.query, ...c.query])];
    if (c.request !== prev.request) prev.request = [prev.request, c.request].filter(Boolean).join(' | ') || null;
    if (!prev.responseKeys && c.keys) Object.assign(prev, { response: c.response, responseArray: c.array, responseKeys: c.keys });
  }
  const endpoints = [...byRoute.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  for (const e of endpoints) e.query.sort();
  return {
    about: 'Generated by scripts/gen-contract.mjs from web/admin/api.ts and web/shared/types.ts. Do not edit by hand.',
    version: 1,
    endpoints,
  };
}

export const contractText = () => `${JSON.stringify(generateContract(), null, 2)}\n`;

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = contractText();
  if (process.argv.includes('--check')) {
    let cur = '';
    try {
      cur = readFileSync(CONTRACT_PATH, 'utf8');
    } catch {
      /* missing */
    }
    if (cur !== text) {
      console.error('web/shared/adminContract.json is out of date: run `npm run contract`.');
      process.exit(1);
    }
    console.log('adminContract.json is up to date.');
  } else {
    writeFileSync(CONTRACT_PATH, text);
    console.log(`Wrote ${CONTRACT_PATH} (${JSON.parse(text).endpoints.length} endpoints).`);
  }
}
