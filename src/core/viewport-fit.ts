// 画面の大きさをルート要素（html・body）に合わせる（8-6d）。
// iPhone を横向きにしたまま起動すると（Safari・ホーム画面から起動の両方）、起動直後の初期包含ブロック（CSS の 100% と
// position: fixed; inset: 0 の基準）が縦の時の高さや状態バーを引いた高さのまま残り、向きを変えるまで直らないことがある。
// 8-6 で canvas を CSS の 100% にしたが、基準の body が小さいままなので下に黒い余白が残った。
// ここでは window.innerWidth / innerHeight・visualViewport・documentElement.clientWidth / clientHeight・（iOS のホーム画面から
// 起動したときは）screen を測って一番もっともらしい大きさを選び、CSS 変数 --app-width / --app-height に書く。
// body は index.html でこの変数の大きさになり、position: fixed の画面（タイトル・メニュー・HUD）の基準にもなる（contain）。
// 測り直すのは読み込みの完了・起動から数秒の間・resize・向きの変更・visualViewport・pageshow・表示に戻ったとき
import { VIEWPORT_CONFIG } from '../data/app';

export interface ViewportSample {
  readonly inner: { readonly width: number; readonly height: number };
  readonly visual: {
    readonly width: number;
    readonly height: number;
    readonly scale: number;
  } | null;
  readonly client: { readonly width: number; readonly height: number };
  readonly screen: { readonly width: number; readonly height: number };
  /** iOS のホーム画面から起動（navigator.standalone。画面全体がアプリになる） */
  readonly iosStandalone: boolean;
  /** 横向きか（screen.orientation・window.orientation。無ければ matchMedia の orientation） */
  readonly landscape: boolean;
  /**
   * screen の大きさを上限にするか（タッチが主の端末だけ。PC はページを縮小表示すると inner が screen より大きくなるので使わない）
   */
  readonly capToScreen: boolean;
}

export interface RootSize {
  readonly width: number;
  readonly height: number;
  /** どの値を使ったか（?debug=viewport の表示） */
  readonly source: string;
}

const ok = (v: number): boolean => Number.isFinite(v) && v >= 1;

/**
 * ルート要素の大きさを選ぶ（DOM 非依存。テストする）。
 * - 基本は inner・visualViewport（拡大していないとき）・client の大きい方（どれかが古い小さい値のまま残っても広がる）
 * - タッチが主の端末では screen の長辺・短辺（向きに合わせる）を超えない（向きを変える前の値で画面からはみ出さない）
 * - iOS のホーム画面から起動したときは画面全体がアプリなので、screen の大きさ（向きに合わせる）を下限にする
 */
export function pickRootSize(s: ViewportSample): RootSize {
  const long = Math.max(s.screen.width, s.screen.height);
  const short = Math.min(s.screen.width, s.screen.height);
  const screenOk = ok(long) && ok(short);
  const screenW = s.landscape ? long : short;
  const screenH = s.landscape ? short : long;
  const capW = screenOk && s.capToScreen ? screenW : Infinity;
  const capH = screenOk && s.capToScreen ? screenH : Infinity;
  const pick = (
    values: readonly [string, number][],
    cap: number,
  ): { value: number; source: string } => {
    let best = { value: 0, source: 'none' };
    for (const [name, v] of values) if (ok(v) && v > best.value) best = { value: v, source: name };
    if (best.value > cap) best = { value: cap, source: `${best.source}>screen` };
    return best;
  };
  const visual = s.visual && Math.abs(s.visual.scale - 1) < 0.01 ? s.visual : null;
  let w = pick(
    [
      ['inner', s.inner.width],
      ['client', s.client.width],
      ['visual', visual?.width ?? 0],
    ],
    capW,
  );
  let h = pick(
    [
      ['inner', s.inner.height],
      ['client', s.client.height],
      ['visual', visual?.height ?? 0],
    ],
    capH,
  );
  if (s.iosStandalone && screenOk) {
    if (w.value < screenW) w = { value: screenW, source: 'screen' };
    if (h.value < screenH) h = { value: screenH, source: 'screen' };
  }
  const width = Math.round(w.value > 0 ? w.value : 1);
  const height = Math.round(h.value > 0 ? h.value : 1);
  return { width, height, source: `${w.source}/${h.source}` };
}

interface NavigatorStandalone {
  standalone?: boolean;
}

/** 今の値を測る */
export function sampleViewport(): ViewportSample {
  const vv = window.visualViewport;
  const nav: Navigator & NavigatorStandalone = navigator;
  const doc = document.documentElement;
  // 向き: screen.orientation（iOS 16.4〜）> window.orientation（古い iOS）> 表示の縦横（初期包含ブロックが古いと外れる）
  const so: unknown = Reflect.get(screen, 'orientation');
  const type: unknown = typeof so === 'object' && so !== null ? Reflect.get(so, 'type') : undefined;
  const angle: unknown = Reflect.get(window, 'orientation');
  const landscape =
    typeof type === 'string'
      ? type.startsWith('landscape')
      : typeof angle === 'number'
        ? Math.abs(angle) === 90
        : window.matchMedia('(orientation: landscape)').matches;
  return {
    inner: { width: window.innerWidth, height: window.innerHeight },
    visual: vv ? { width: vv.width, height: vv.height, scale: vv.scale } : null,
    client: { width: doc.clientWidth, height: doc.clientHeight },
    screen: { width: screen.width, height: screen.height },
    iosStandalone: nav.standalone === true,
    landscape,
    capToScreen: window.matchMedia('(pointer: coarse)').matches,
  };
}

/** 最後に書いた大きさ（?debug=viewport の表示） */
export const rootSize = { width: 0, height: 0, source: '', count: 0 };

/** 測った値が変わった時刻と値（?debug=viewport の表示。起動直後から最新 10 件） */
export const fitHistory: string[] = [];
let lastSample = '';

function remember(s: ViewportSample, size: RootSize): void {
  const v = s.visual ? `${Math.round(s.visual.width)}x${Math.round(s.visual.height)}` : '-';
  const line = `inner ${s.inner.width}x${s.inner.height} client ${s.client.width}x${s.client.height} visual ${v} ${s.landscape ? 'L' : 'P'} -> ${size.width}x${size.height}`;
  if (line === lastSample) return;
  lastSample = line;
  fitHistory.push(`${(performance.now() / 1000).toFixed(2)}s ${line}`);
  if (fitHistory.length > 10) fitHistory.shift();
}

/** 測って CSS 変数に書く。変わっていれば true */
export function fitRoot(doc: Document = document): boolean {
  const sample = sampleViewport();
  const size = pickRootSize(sample);
  remember(sample, size);
  rootSize.count++;
  rootSize.source = size.source;
  if (size.width === rootSize.width && size.height === rootSize.height) return false;
  rootSize.width = size.width;
  rootSize.height = size.height;
  const style = doc.documentElement.style;
  style.setProperty('--app-width', `${size.width}px`);
  style.setProperty('--app-height', `${size.height}px`);
  return true;
}

/** 起動の最初に 1 回呼ぶ（main.ts） */
export function installViewportFit(): void {
  fitRoot();
  const now = (): void => {
    fitRoot();
  };
  const later = (): void => {
    fitRoot();
    requestAnimationFrame(now);
    for (const ms of VIEWPORT_CONFIG.recheckMs) setTimeout(now, ms);
  };
  // 起動から数秒の間（iOS は横向きの起動で、しばらくしてから値が正しくなることがある）
  for (const ms of VIEWPORT_CONFIG.startupRecheckMs) setTimeout(now, ms);
  window.addEventListener('load', later);
  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', later);
  window.addEventListener('pageshow', later);
  window.addEventListener('focus', later);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') later();
  });
  window.visualViewport?.addEventListener('resize', later);
  const orientation: unknown = Reflect.get(screen, 'orientation');
  if (orientation instanceof EventTarget) orientation.addEventListener('change', later);
}
