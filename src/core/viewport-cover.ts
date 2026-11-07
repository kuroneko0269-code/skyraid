// 8-6f: 測り直させる間（viewport-fit の切り替え）の画面のチラつきを隠す黒い幕（index.html の .viewport-cover）。
// 8-7: 中央にタイトルのロゴ（読めなければ「SkyRaid」の文字）。
// v1.0.1: ロゴは飾り。読めない・遅い・作るときに例外が出ても、幕の出し入れと測り直しは止めない（ロゴの処理は try の中、
// 時間切れで文字に切り替え）。出し入れとロゴの結果は viewport-log.ts に残す
// 10-1b: 幕のロゴはばねで揺れながら幕の中央を追い、外すときはタイトルの文字の位置と大きさへ移って重なってから幕を明ける
// （cover-logo.ts）。記録の「off」は今までどおり外すと決めた時刻（移る間は幕を残す）。動きを省く設定ではその場で外す
// 10-1c: ロゴはグリッチで乱れる（試みのたびに強く）。重なったら幕のロゴとタイトルの文字に短い「信号」の乱れを走らせて明ける
import { BRAND_ASSETS, VIEWPORT_CONFIG } from '../data/app';
import { CoverLogoMotion, prefersReducedMotion, type LandingResult } from './cover-logo';
import type { LogoBox } from './cover-motion';
import { noteStartup } from './viewport-log';

let cover: HTMLElement | null = null;
let motion: CoverLogoMotion | null = null;
/** 外すと決めてから幕が明けるまで（タイトルの文字へ移る間）か */
let revealing = false;
/** 幕が明け始めたら呼ぶもの（タイトルの展開アニメ・本体の読み込み。app.ts） */
const goneListeners: (() => void)[] = [];
/** 着く先（タイトルの文字の見えている箱。まだ出ていなければ null。app.ts がタイトルを作ったら入れる） */
let landingTarget: (() => LogoBox | null) | null = null;
/** 10-1c: 重なったときに呼ぶもの（タイトルの文字の短い乱れ） */
let landedHook: (() => void) | null = null;

/** 点検（ui-audit-device）: 最後に着いたときの結果（移らずに外したら null のまま） */
export const coverLanding: { result: LandingResult | null } = { result: null };

/** 幕が出ているか（外すと決めてから明けるまでも含む） */
export function coverActive(): boolean {
  return cover !== null || revealing;
}

/** 幕が明け始めたときに 1 回呼ぶ（幕が無ければすぐ） */
export function onCoverGone(fn: () => void): void {
  if (!coverActive()) fn();
  else goneListeners.push(fn);
}

/** 着く先を入れる（タイトルの文字。app.ts） */
export function setCoverLandingTarget(fn: () => LogoBox | null, onLanded?: () => void): void {
  landingTarget = fn;
  landedHook = onLanded ?? null;
}
/** 幕の時間切れ（試みのたびに延ばす。起動が重くて試みが遅れても、途中で外さない） */
let coverTimer = 0;

export function extendCover(): void {
  if (!cover) return;
  // 10-1c: 測り直しを試みるたびに強く乱す（飾り。例外で試みを止めない）
  try {
    motion?.pulse();
  } catch {
    /* 飾り */
  }
  window.clearTimeout(coverTimer);
  coverTimer = window.setTimeout(() => {
    hideCover('timeout');
  }, VIEWPORT_CONFIG.nudge.coverMaxMs);
}

export function showCover(): void {
  if (cover) return;
  const c = document.createElement('div');
  c.className = 'viewport-cover';
  c.setAttribute('aria-hidden', 'true');
  try {
    fillCover(c);
  } catch (e) {
    c.classList.add('is-text');
    noteStartup('cover', `logo skipped (${e instanceof Error ? e.name : 'error'})`);
  }
  cover = c;
  document.body.appendChild(c);
  noteStartup('cover', 'on');
  extendCover();
  // 10-1b: ロゴの動き（飾り。例外が出ても幕の出し入れは止めない）
  if (!prefersReducedMotion()) {
    try {
      motion = new CoverLogoMotion(c);
      motion.start();
    } catch {
      motion = null;
    }
  }
}

/** 中央にロゴ（読めたら出す。読めない・時間切れなら「SkyRaid」の文字）。幕の出し入れ・時刻には関わらない */
function fillCover(c: HTMLElement): void {
  const img = document.createElement('img');
  img.className = 'viewport-cover-logo';
  img.alt = '';
  img.decoding = 'async';
  let settled = false;
  const settle = (text: string, loaded: boolean): void => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    if (loaded) img.classList.add('is-loaded');
    else {
      c.classList.add('is-text');
      motion?.refresh();
    }
    noteStartup('cover', text);
  };
  const timer = window.setTimeout(() => {
    settle('logo timeout', false);
  }, VIEWPORT_CONFIG.nudge.logoTimeoutMs);
  img.onload = () => {
    if (img.naturalWidth > 0) settle('logo ok', true);
    else settle('logo empty', false);
  };
  img.onerror = () => {
    settle('logo error', false);
  };
  const text = document.createElement('span');
  text.className = 'viewport-cover-text';
  text.textContent = 'SkyRaid';
  c.append(img, text);
  img.src = `${import.meta.env.BASE_URL}${BRAND_ASSETS.logo}`;
}

/** 外す（reason は記録に出す: fixed = 直った・tries done = 試みが尽きた・timeout = 上限の時間など） */
export function hideCover(reason: string): void {
  const c = cover;
  if (!c) return;
  cover = null;
  window.clearTimeout(coverTimer);
  noteStartup('cover', `off (${reason})`);
  const m = motion;
  motion = null;
  revealing = true;
  const fade = (): void => {
    m?.stop();
    revealing = false;
    c.classList.add('is-hiding');
    window.setTimeout(() => {
      c.remove();
    }, VIEWPORT_CONFIG.nudge.coverFadeMs);
    for (const fn of goneListeners.splice(0)) fn();
  };
  if (!m || !landingTarget) {
    fade();
    return;
  }
  // 10-1b: タイトルの文字が出るのを待って（landWaitMs まで）そこへ移り、重なったら明ける
  const target = landingTarget;
  const waitStart = performance.now();
  const wait = (): void => {
    if (target()) {
      m.land(target, (r) => {
        coverLanding.result = r;
        // 10-1c: 重なった: 幕のロゴにも、タイトルの文字（title.ts）と同じ短い乱れ
        if (r) {
          try {
            signal(c);
            landedHook?.();
          } catch {
            /* 飾り */
          }
        }
        fade();
      });
    } else if (performance.now() - waitStart > VIEWPORT_CONFIG.coverLogo.landWaitMs) fade();
    else requestAnimationFrame(wait);
  };
  wait();
}

/** 10-1c: 重なったときの短い乱れ（index.html の skyraid-signal。タイトルの文字は title.ts が同じものを走らせる） */
export function signal(target: HTMLElement): void {
  const g = VIEWPORT_CONFIG.coverLogo.glitch;
  target.style.setProperty('--signal-ms', `${g.signalMs}ms`);
  target.style.setProperty('--signal-px', `${g.signalPx}px`);
  target.style.setProperty('--signal-red', g.red);
  target.style.setProperty('--signal-cyan', g.cyan);
  target.classList.remove('is-signal');
  target.classList.add('is-signal');
  window.setTimeout(() => {
    target.classList.remove('is-signal');
  }, g.signalMs + 50);
}
