// 英語化（8-4）の抜け防止: ja / en のキーとプレースホルダが一致する・コードの t('…') のキーが表にある・
// src に日本語の直書きが残っていない（コメント・GLSL のコメント・除外リストは除く）
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { t, tn, getLocale } from '../src/core/i18n';
import { tableFor, useLocale } from './i18n-helpers';
import type { MessageTree } from '../src/core/i18n';

const ROOT = join(import.meta.dirname, '..');
const JA_RE = /[぀-ヿ㐀-鿿！-｠]/;
const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/** 日本語を残してよい文字列（ファイル: 理由）。ここに無い日本語の直書きはテストで落とす */
const ALLOWED_JA: Readonly<Record<string, readonly string[]>> = {
  // 言語の切り替えの選択肢は、どちらの言語でもその言語の名前で出す
  'src/ui/language-settings.ts': ['日本語'],
};

function isPlural(v: MessageTree): boolean {
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => PLURAL_FORMS.has(k));
}

/** 葉のキーと値（複数形のまとまりは 1 つの葉: 値は other） */
function leaves(tree: MessageTree, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else if (Array.isArray(v)) out.set(key, v.join('\n'));
    else if (isPlural(v as MessageTree)) {
      const forms = v as Record<string, string>;
      out.set(key, Object.values(forms).join('\n'));
    } else leaves(v as MessageTree, key, out);
  }
  return out;
}

function placeholders(s: string): string[] {
  return [...new Set([...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1] ?? ''))].sort();
}

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js)$/.test(f)) out.push(p);
  }
  return out;
}

/** テンプレート文字列の中の GLSL のコメント（// と /* *\/）を除く */
function stripGlslComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

interface Literal {
  readonly file: string;
  readonly text: string;
  readonly line: number;
}

function literals(file: string): Literal[] {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out: Literal[] = [];
  const visit = (node: ts.Node): void => {
    let text: string | null = null;
    if (ts.isStringLiteral(node)) text = node.text;
    else if (
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      text = stripGlslComments(node.text);
    if (text !== null) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      out.push({ file: relative(ROOT, file), text, line });
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
}

const SRC_FILES = walk(join(ROOT, 'src'));

describe('文言の表（8-4）', () => {
  const ja = leaves(tableFor('ja'));
  const en = leaves(tableFor('en'));

  it('ja と en のキーが一致する', () => {
    expect([...en.keys()].filter((k) => !ja.has(k))).toEqual([]);
    expect([...ja.keys()].filter((k) => !en.has(k))).toEqual([]);
  });

  it('ja と en でプレースホルダ（{name}）が一致する', () => {
    const diff: string[] = [];
    for (const [k, v] of ja) {
      const e = en.get(k);
      if (e !== undefined && placeholders(v).join() !== placeholders(e).join()) diff.push(k);
    }
    expect(diff).toEqual([]);
  });

  it('英語の文に日本語が混じっていない（空でもない）', () => {
    const bad = [...en].filter(([, v]) => JA_RE.test(v) || v.trim() === '').map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("コードの t('…') / tn('…') / tList('…') のキーはすべて表にある", () => {
    const missing: string[] = [];
    const re = /\b(?:t|tn|tList)\(\s*'([a-zA-Z0-9_.-]+)'/g;
    for (const f of SRC_FILES) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(re)) {
        const key = m[1] ?? '';
        if (!ja.has(key)) missing.push(`${relative(ROOT, f)}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('src に日本語の直書きが残っていない（コメントと除外リストは除く）', () => {
    const found: string[] = [];
    for (const f of SRC_FILES) {
      for (const lit of literals(f)) {
        if (!JA_RE.test(lit.text)) continue;
        if (ALLOWED_JA[lit.file]?.includes(lit.text)) continue;
        found.push(`${lit.file}:${lit.line} ${lit.text.slice(0, 40)}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('public・index.html・legacy-check に日本語の文言を直書きしない（コメントは除く）', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(JA_RE.test(html)).toBe(false);
    for (const f of walk(join(ROOT, 'public'))) {
      const bad = literals(f).filter((l) => JA_RE.test(l.text));
      expect(bad.map((l) => `${l.file}:${l.line}`)).toEqual([]);
    }
  });
});

describe('t / tn（8-4）', () => {
  it('プレースホルダを置き換え、無いキーはキーそのもの', () => {
    expect(t('lobby.pvp.note', { max: 4 })).toBe('2〜4 人で同じ空を飛ぶ');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('複数形: 英語は one / other、日本語は other', () => {
    useLocale('en');
    expect(getLocale()).toBe('en');
    expect(tn('common.waves', 1)).toBe('1 wave');
    expect(tn('common.waves', 7)).toBe('7 waves');
    expect(tn('common.waves', 1200)).toBe('1,200 waves');
    useLocale('ja');
    expect(tn('common.waves', 1)).toBe('1 波');
  });
});
