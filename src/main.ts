// エントリ（8-3）: WebGL 2 の描画を作れたらゲーム本体（app.ts）を起動し、作れなければ案内画面を出す（真っ黒にしない）。
// <html data-app> は legacy-check.js（src/legacy/。8-4）への合図（このモジュールが動いた = 古いブラウザで構文エラーになっていない）
// 8-4: 画面を作る前に今の言語の文言の表を読み込む（?lang= > セーブの設定 > ブラウザの言語）
import { WebGLRenderer } from 'three';
import { startApp } from './app';
import { loadLocale } from './core/i18n-load';
import { detectLocale } from './core/locale';
import { readSavedLanguage } from './progression/save-language';
import { installViewportFit } from './core/viewport-fit';
import { probeWebGL, showCompatNotice, webglProblem } from './ui/compat-notice';
import { installViewportDebug } from './ui/viewport-debug-toggle';

document.documentElement.dataset.app = 'started';
// 8-6d: html・body の大きさを測った画面の大きさに（横向きで起動したときの下の黒い余白）。言語の読み込みより先に
installViewportFit();

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

await loadLocale(
  detectLocale(
    window.location.search,
    navigator.languages,
    readSavedLanguage(localStorageOrNull()),
  ),
);

function createRenderer(container: HTMLElement): WebGLRenderer | null {
  try {
    const renderer = new WebGLRenderer({ antialias: true });
    // 表示の大きさは CSS（index.html の #app > canvas）。描画バッファは起動後に core/viewport.ts が合わせる（8-6）
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    container.appendChild(renderer.domElement);
    return renderer;
  } catch {
    // three は WebGL 2 のコンテキストを作れないと例外（console にも出す）
    return null;
  }
}

const container = document.getElementById('app');
if (!container) throw new Error('#app not found');
const renderer = createRenderer(container);
if (!renderer) {
  showCompatNotice(document.body, webglProblem(probeWebGL(document)));
} else {
  const startFailed = (e: unknown): void => {
    console.error(e);
    renderer.domElement.remove();
    showCompatNotice(document.body, 'start-failed', String(e).slice(0, 200));
  };
  try {
    // 10-1: 本体（game-app.ts）は遅延チャンク。組み立ての例外は startFailed で同じ案内
    startApp(renderer, startFailed);
    // ?debug=viewport・タイトルの版の表示を 5 回押す: 画面の大きさの値を左上に（8-6d）
    installViewportDebug(document.querySelector('.title-version'));
  } catch (e) {
    startFailed(e);
  }
}
