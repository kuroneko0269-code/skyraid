// 8-4: 古いブラウザの案内（src/legacy/legacy-check.js。ES5 の classic script）に文言の表（src/data/i18n の compat.*）の
// 日本語・英語をビルド時に埋め込む。開発サーバーでは /legacy-check.js として配信し、本番ビルドでは dist/legacy-check.js に出す
// （index.html の <script src="/legacy-check.js" defer> はそのまま）。
// あわせて index.html の meta description（__APP_DESCRIPTION__）を ja.json の app.description にする（起動後は src/core/i18n-load.ts が
// 今の言語に書き換える）
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

type Tree = { readonly [key: string]: unknown };
export type LegacyLocale = 'ja' | 'en';

/** 案内に出す文（src/legacy/legacy-check.js の STRINGS[言語] の形） */
export interface LegacyStrings {
  readonly title: string;
  readonly body: string;
  readonly environment: string;
  readonly items: readonly string[];
  readonly note: string;
}

const MARK = '__LEGACY_STRINGS__';
const DESCRIPTION_MARK = '__APP_DESCRIPTION__';
const FILE = 'legacy-check.js';

function isTree(v: unknown): v is Tree {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readTree(path: string): Tree {
  const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return isTree(v) ? v : {};
}

/** 言語の表（src/data/i18n/<言語>.json） */
export function readTable(root: string, locale: LegacyLocale): Tree {
  return readTree(`${root}/src/data/i18n/${locale}.json`);
}

/** 点区切りのキーの文。無ければビルドを止める（案内が空にならないように） */
export function message(table: Tree, key: string): string {
  let node: unknown = table;
  for (const part of key.split('.')) node = isTree(node) ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`[legacy-check] missing i18n key: ${key}`);
  return node;
}

/** 表 → 案内の文（動作環境の行は src/data/compat.ts の MIN_ENVIRONMENT と同じ「端末: ブラウザ」） */
export function legacyStrings(table: Tree): LegacyStrings {
  const m = (key: string): string => message(table, key);
  return {
    title: m('compat.legacy.title'),
    body: m('compat.legacy.body'),
    environment: m('compat.environment'),
    items: [
      `iPhone / iPad: ${m('compat.env.ios')}`,
      `Android: ${m('compat.env.android')}`,
      `${m('compat.env.pcPlatform')}: ${m('compat.env.pc')}`,
    ],
    note: m('compat.note'),
  };
}

/** 埋め込み済みのスクリプト。文字列は JSON（ES5 でもそのまま読める）。U+2028/2029 は念のため逃がす */
export function buildLegacyScript(
  source: string,
  tables: Readonly<Record<LegacyLocale, Tree>>,
): string {
  if (!source.includes(MARK)) throw new Error(`[legacy-check] ${MARK} not found`);
  const json = JSON.stringify({ ja: legacyStrings(tables.ja), en: legacyStrings(tables.en) })
    .split(String.fromCharCode(0x2028))
    .join('\\u2028')
    .split(String.fromCharCode(0x2029))
    .join('\\u2029');
  return source.replace(MARK, () => json);
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function legacyCheck(root: string): Plugin {
  const script = (): string =>
    buildLegacyScript(readFileSync(`${root}/src/legacy/${FILE}`, 'utf8'), {
      ja: readTable(root, 'ja'),
      en: readTable(root, 'en'),
    });
  return {
    name: 'skyraid-legacy-check',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== `/${FILE}`) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.end(script());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: FILE, source: script() });
    },
    transformIndexHtml(html) {
      const description = escapeAttr(message(readTable(root, 'ja'), 'app.description'));
      return html.replace(DESCRIPTION_MARK, description);
    },
  };
}
