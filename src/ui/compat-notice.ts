// 起動できないときの案内画面（8-3）: WebGL が無い / WebGL 2 が無い / 起動中の例外。真っ黒のままにしない。
// 見た目は index.html の <style> の .compat-notice（アプリの CSS が読めない古いブラウザでも同じ。public/legacy-check.js も使う）
import {
  COMPAT_NOTICE,
  MIN_ENVIRONMENT,
  MIN_ENVIRONMENT_NOTE,
  type CompatProblem,
} from '../data/compat';

/** WebGL の使える範囲を調べる（描画を作れなかったときだけ呼ぶ。作った試しのコンテキストはすぐ手放す） */
export function probeWebGL(doc: Document): 'webgl2' | 'webgl' | 'none' {
  const tryGet = (kind: 'webgl2' | 'webgl'): boolean => {
    try {
      const canvas = doc.createElement('canvas');
      const gl = kind === 'webgl2' ? canvas.getContext('webgl2') : canvas.getContext('webgl');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      return gl !== null;
    } catch {
      // 例外は「使えない」とみなす
      return false;
    }
  };
  if (tryGet('webgl2')) return 'webgl2';
  return tryGet('webgl') ? 'webgl' : 'none';
}

/** 描画を作れなかったときの問題の種類 */
export function webglProblem(support: 'webgl2' | 'webgl' | 'none'): CompatProblem {
  // WebGL 2 があるのに作れなかったときは、GPU の不調・上限などで WebGL 自体が使えないのと同じ案内にする
  return support === 'webgl' ? 'no-webgl2' : 'no-webgl';
}

/** 案内画面を出す（ほかの画面は作らない）。detail は起動中の例外の文（開発者向けに小さく出す） */
export function showCompatNotice(parent: HTMLElement, problem: CompatProblem, detail = ''): void {
  const text = COMPAT_NOTICE[problem];
  const root = document.createElement('div');
  root.className = 'compat-notice';
  root.setAttribute('role', 'alert');
  const add = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls: string,
    to: HTMLElement,
    content?: string,
  ): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    e.className = cls;
    if (content !== undefined) e.textContent = content;
    to.appendChild(e);
    return e;
  };
  const box = add('div', 'compat-notice-box', root);
  add('div', 'compat-notice-app', box, 'SkyRaid: Titan Skies');
  add('h1', 'compat-notice-title', box, text.title);
  add('p', 'compat-notice-text', box, text.body);
  add('h2', 'compat-notice-sub', box, '動作環境');
  const list = add('ul', 'compat-notice-list', box);
  for (const m of MIN_ENVIRONMENT) add('li', '', list, `${m.platform}: ${m.browser}`);
  add('p', 'compat-notice-note', box, MIN_ENVIRONMENT_NOTE);
  if (detail) add('p', 'compat-notice-detail', box, detail);
  const reload = add('button', 'compat-notice-button', box, '再読み込み');
  reload.type = 'button';
  reload.addEventListener('click', () => {
    location.reload();
  });
  parent.appendChild(root);
}
