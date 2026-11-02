// エントリ（8-3）: WebGL 2 の描画を作れたらゲーム本体（app.ts）を起動し、作れなければ案内画面を出す（真っ黒にしない）。
// <html data-app> は public/legacy-check.js への合図（このモジュールが動いた = 古いブラウザで構文エラーになっていない）
// 8-4: 画面を作る前に今の言語の文言の表を読み込む（?lang= > セーブの設定 > ブラウザの言語）
import { WebGLRenderer } from 'three';
import { startApp } from './app';
import { loadLocale } from './core/i18n-load';
import { detectLocale } from './core/locale';
import { readSavedLanguage } from './progression/save-language';
import { probeWebGL, showCompatNotice, webglProblem } from './ui/compat-notice';

document.documentElement.dataset.app = 'started';

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

await loadLocale(
  detectLocale(window.location.search, navigator.languages, readSavedLanguage(localStorageOrNull())),
);

function createRenderer(container: HTMLElement): WebGLRenderer | null {
  try {
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
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
  try {
    startApp(renderer);
  } catch (e) {
    console.error(e);
    renderer.domElement.remove();
    showCompatNotice(document.body, 'start-failed', String(e).slice(0, 200));
  }
}
