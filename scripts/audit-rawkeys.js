/* global document, Node, URL */
// 9-11b: 画面に文言のキーがそのまま出ていないかの点検（M6 の目標に「objectives.wave」が出た不具合の再発防止）。
// ページの文書全体（今は隠れている画面・HUD も。起動時に作った画面の文も見る）の文字と、placeholder / aria-label / title から
// 「英字.英字」の形（objectives.wave・missions.finale.title など）を拾い、先頭が文言の表（src/data/i18n/ja.json）の最上位の名前の
// ものを「生のキー」とする（URL・ファイル名・ドメインを数えないため）。ライセンス一覧の本文（他人の文）・入力欄の値は見ない。
// 使い方: `const issues = await rawKeysOn(page)` → [{ kind: 'rawKey', target: 'objectives.wave（表示中）div.objective-row …' }]
import { readFileSync } from 'node:fs';

const TABLE = JSON.parse(
  readFileSync(new URL('../src/data/i18n/ja.json', import.meta.url), 'utf8'),
);
/** 文言の表の最上位の名前（app・missions・objectives …） */
const NAMESPACES = new Set(Object.keys(TABLE));
/** 「英字.英字」の形（2 つめ以降は - も。前後が URL・パス・メールの続きのものは除く） */
const KEY_LIKE = /(?<![\w./@:#-])([a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9-]*)+)(?![\w/@-])/g;
const FILE_EXT = /\.(png|jpe?g|webp|svg|json|js|ts|css|html|webmanifest|skyreplay|txt|md)$/i;

/** ページの中で動かす: 文書の文字（要素ごと）と、見えているか */
export function collectTexts() {
  const SKIP = 'script, style, noscript, textarea, .info-license-text';
  const out = [];
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && e.closest('[hidden]') === null;
  };
  const path = (e) => {
    const parts = [];
    for (let n = e; n && n !== document.body && parts.length < 3; n = n.parentElement) {
      const cls = [...n.classList].slice(0, 2).join('.');
      parts.unshift(cls ? `${n.tagName.toLowerCase()}.${cls}` : n.tagName.toLowerCase());
    }
    return parts.join(' > ');
  };
  const walker = document.createTreeWalker(document.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const e = n.parentElement;
    const text = n.nodeValue ?? '';
    if (!e || n.nodeType !== Node.TEXT_NODE || !/[a-z]\.[A-Za-z]/.test(text) || e.closest(SKIP))
      continue;
    out.push({ text, shown: vis(e), at: path(e) });
  }
  for (const e of document.querySelectorAll('[placeholder], [aria-label], [title]')) {
    if (e.closest(SKIP)) continue;
    for (const a of ['placeholder', 'aria-label', 'title']) {
      const text = e.getAttribute(a) ?? '';
      if (/[a-z]\.[A-Za-z]/.test(text)) out.push({ text, shown: vis(e), at: `${path(e)} [${a}]` });
    }
  }
  return out;
}

/** 文の中の生のキー */
export function findRawKeys(text) {
  const keys = [];
  for (const m of text.matchAll(KEY_LIKE)) {
    const key = m[1];
    if (NAMESPACES.has(key.split('.')[0]) && !FILE_EXT.test(key)) keys.push(key);
  }
  return keys;
}

/** ページの生のキー（点検の issues の形）。同じキー・同じ場所は 1 つに */
export async function rawKeysOn(page) {
  const texts = await page.evaluate(collectTexts);
  const seen = new Set();
  const issues = [];
  for (const t of texts)
    for (const key of findRawKeys(t.text)) {
      const target = `${key}（${t.shown ? '表示中' : '隠れている'}）${t.at}`;
      if (seen.has(target)) continue;
      seen.add(target);
      issues.push({ kind: 'rawKey', target });
    }
  return issues;
}
