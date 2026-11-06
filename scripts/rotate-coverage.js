/* global document, HTMLElement, URL */
// 回転の点検（ui-audit-device-rotate.js）の対象の洗い出し（9-9c）: src/ui の全部の画面とダイアログを、ソースから自動で拾う。
// - 画面: createScreen(parent, '<クラス>') の <クラス>
// - ダイアログ: el('div', '<クラス>') のうち、クラスに ui-dialog か mode-prompt を含むもの
// 点検で測った要素（とその中のダイアログ）から、どの <クラス> を確かめたかを数え、残りは表示を強めて確かめる（forceShow）。
// それでも DOM に無いもの（まだ読み込まれていない画面）は「点検していない」として失敗にする。新しい画面・ダイアログを
// 足すと自動でここに入るので、点検から漏れない
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const UI_DIR = new URL('../src/ui/', import.meta.url).pathname;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** 画面とダイアログのクラスの一覧（重複なし。{ kind, classes, file }） */
export function uiRoots() {
  const roots = new Map();
  for (const file of files(UI_DIR)) {
    const src = readFileSync(file, 'utf8');
    const rel = file.slice(UI_DIR.length);
    for (const m of src.matchAll(/createScreen\(\s*\w+\s*,\s*'([^']+)'\s*\)/g))
      roots.set(m[1], { kind: 'screen', classes: m[1], file: rel });
    for (const m of src.matchAll(/el\(\s*'div'\s*,\s*'([^']+)'/g)) {
      const tokens = m[1].split(/\s+/);
      if (tokens.includes('ui-dialog') || tokens.includes('mode-prompt'))
        roots.set(m[1], { kind: 'dialog', classes: m[1], file: rel });
    }
  }
  return [...roots.values()];
}

/**
 * ページの中（page.evaluate で送る。外の変数は使わない）: 要素がどのクラスの組に当たるか（含むクラスがいちばん多い組）。
 * keys は uiRoots の classes の一覧。
 * 戻り値は measured の中（と中のダイアログ）で当たった組の一覧
 */
export function coveredIn({ rootSelector, keys }) {
  const best = (el) => {
    let pick = null;
    let n = 0;
    for (const k of keys) {
      const t = k.split(/\s+/);
      if (t.length > n && t.every((c) => el.classList.contains(c))) {
        pick = k;
        n = t.length;
      }
    }
    return pick;
  };
  const root = document.querySelector(rootSelector);
  if (!root) return [];
  const shown = (e) => e.getClientRects().length > 0 && e.closest('[hidden]') === null;
  const found = new Set();
  for (const e of [root, ...root.querySelectorAll('.ui-dialog, .mode-prompt')]) {
    if (!shown(e)) continue;
    const k = best(e);
    if (k) found.add(k);
  }
  return [...found];
}

/**
 * ページの中（page.evaluate で送る）: 組 key に当たる要素を表示を強めて出す（hidden を外し、入っている画面を is-shown に）。
 * 出せたら測る要素のセレクタ（data-rotate-target）、DOM に無ければ null
 */
export function forceShow({ key, keys }) {
  const tokens = key.split(/\s+/);
  const fits = (el) => {
    // ほかにもっと多く当たる組があれば、それはその組の要素
    let n = 0;
    for (const k of keys) {
      const t = k.split(/\s+/);
      if (t.every((c) => el.classList.contains(c))) n = Math.max(n, t.length);
    }
    return n === tokens.length;
  };
  const el = [...document.querySelectorAll(`.${tokens.join('.')}`)].find(fits);
  if (!el) return null;
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n instanceof HTMLElement) n.hidden = false;
    if (n.classList.contains('screen')) {
      n.classList.add('is-shown');
      n.inert = false;
    }
  }
  el.dataset.rotateTarget = '1';
  return '[data-rotate-target="1"]';
}
