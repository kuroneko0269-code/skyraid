// ?debug=viewport・タイトルの版の表示を 5 回押す（8-6d。viewport-debug-toggle.ts）: 画面の左上に、画面の大きさに関わる値を出す（実機の iPhone で撮って送ってもらうため）。
// innerWidth / innerHeight・visualViewport・screen・documentElement.clientWidth / clientHeight・100vh / dvh / svh / lvh・
// html / body / #app / canvas の実寸と描画バッファ・安全領域（env(safe-area-inset-*)）・ホーム画面からの起動かと、
// 起動からの値の変化の記録（ルート要素を合わせたときの測った値（起動直後から最新 10 件）と、この表示の値（最新 4 件））、
// v1.0.1: 起動時の見張り・黒い幕とロゴ・測り直しの試みの記録（startup / cover / nudge の行）。0.5 秒ごとに書き直す。触っても下の画面に届く（pointer-events: none）
import './viewport-debug.css';
import { fitHistory, rootSize } from '../core/viewport-fit';
import { startupSummary } from '../core/viewport-log';
import { viewport } from '../core/viewport';

interface NavigatorStandalone {
  standalone?: boolean;
}

const r = (n: number): string => String(Math.round(n * 10) / 10);
const size = (w: number, h: number): string => `${r(w)}x${r(h)}`;
const rect = (e: Element | null): string => {
  if (!e) return '-';
  const b = e.getBoundingClientRect();
  return `${size(b.width, b.height)} @${r(b.left)},${r(b.top)}`;
};

/** 測るための見えない要素（vh の各単位と安全領域） */
function probe(parent: HTMLElement, cls: string): HTMLElement {
  const p = document.createElement('div');
  p.className = `viewport-debug-probe ${cls}`;
  parent.appendChild(p);
  return p;
}

/** 出す。戻り値で消す */
export function showViewportDebug(): () => void {
  const box = document.createElement('pre');
  box.className = 'viewport-debug';
  box.setAttribute('aria-hidden', 'true');
  document.body.appendChild(box);
  const probes = document.createElement('div');
  probes.className = 'viewport-debug-probes';
  document.body.appendChild(probes);
  const units = ['vh', 'dvh', 'svh', 'lvh'].map((u) => [u, probe(probes, `is-${u}`)] as const);
  const safe = probe(probes, 'is-safe');
  const history: string[] = [];
  let last = '';

  const modes = (): string =>
    ['standalone', 'fullscreen', 'minimal-ui', 'browser']
      .filter((m) => window.matchMedia(`(display-mode: ${m})`).matches)
      .join(',');

  const render = (): void => {
    const vv = window.visualViewport;
    const nav: Navigator & NavigatorStandalone = navigator;
    const doc = document.documentElement;
    const canvas = document.querySelector<HTMLCanvasElement>('#app > canvas');
    const orientation: unknown = Reflect.get(screen, 'orientation');
    const type: unknown = orientation ? Reflect.get(orientation, 'type') : undefined;
    const angle: unknown = Reflect.get(window, 'orientation');
    const s = getComputedStyle(safe);
    const key = [
      `inner ${size(window.innerWidth, window.innerHeight)}`,
      `client ${size(doc.clientWidth, doc.clientHeight)}`,
      `visual ${vv ? `${size(vv.width, vv.height)} x${r(vv.scale)} top${r(vv.offsetTop)}` : '-'}`,
      `root ${size(rootSize.width, rootSize.height)} ${rootSize.source}`,
      `canvas ${rect(canvas)}`,
    ].join(' | ');
    if (key !== last) {
      last = key;
      history.push(`${(performance.now() / 1000).toFixed(1)}s ${key}`);
      if (history.length > 4) history.shift();
    }
    box.textContent = [
      `t ${(performance.now() / 1000).toFixed(1)}s (since load)  dpr ${r(window.devicePixelRatio)}`,
      `inner   ${size(window.innerWidth, window.innerHeight)}  outer ${size(window.outerWidth, window.outerHeight)}`,
      `visual  ${vv ? `${size(vv.width, vv.height)} scale ${r(vv.scale)} off ${r(vv.offsetLeft)},${r(vv.offsetTop)}` : '-'}`,
      `screen  ${size(screen.width, screen.height)} avail ${size(screen.availWidth, screen.availHeight)}`,
      `orient  ${typeof type === 'string' ? type : '-'} / ${typeof angle === 'number' ? angle : '-'}`,
      `client  ${size(doc.clientWidth, doc.clientHeight)}`,
      `units   ${units.map(([u, p]) => `100${u}=${r(p.getBoundingClientRect().height)}`).join(' ')}`,
      `safe    t${s.paddingTop} r${s.paddingRight} b${s.paddingBottom} l${s.paddingLeft}`,
      `app     standalone=${String(nav.standalone ?? '-')} mode=${modes()}`,
      `root    --app ${size(rootSize.width, rootSize.height)} (${rootSize.source}, ${rootSize.count})`,
      `html    ${rect(doc)}`,
      `body    ${rect(document.body)}`,
      `#app    ${rect(document.getElementById('app'))}`,
      `canvas  ${rect(canvas)} buf ${canvas ? size(canvas.width, canvas.height) : '-'} view ${size(viewport.width, viewport.height)}`,
      // v1.0.1: 起動時の見張り・幕（ロゴ）・測り直しの試みが動いたか（viewport-log.ts。値の記録に押し出されない）
      `startup ${startupSummary('startup')}`,
      `cover   ${startupSummary('cover')}`,
      `nudge   ${startupSummary('nudge')}`,
      'fit (viewport-fit.ts, since load):',
      ...fitHistory,
      'shown:',
      ...history,
    ].join('\n');
  };
  render();
  const timer = window.setInterval(render, 500);
  return () => {
    window.clearInterval(timer);
    box.remove();
    probes.remove();
  };
}
