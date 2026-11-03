// 8-6f: 測り直させる間（viewport-fit の切り替え）の画面のチラつきを隠す黒い幕（index.html の .viewport-cover）。
// 8-7: 中央にタイトルのロゴ（読めなければ「SkyRaid」の文字）。
// v1.0.1: ロゴは飾り。読めない・遅い・作るときに例外が出ても、幕の出し入れと測り直しは止めない（ロゴの処理は try の中、
// 時間切れで文字に切り替え）。出し入れとロゴの結果は viewport-log.ts に残す
import { BRAND_ASSETS, VIEWPORT_CONFIG } from '../data/app';
import { noteStartup } from './viewport-log';

let cover: HTMLElement | null = null;
/** 幕の時間切れ（試みのたびに延ばす。起動が重くて試みが遅れても、途中で外さない） */
let coverTimer = 0;

export function extendCover(): void {
  if (!cover) return;
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
    else c.classList.add('is-text');
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
  c.classList.add('is-hiding');
  window.setTimeout(() => {
    c.remove();
  }, VIEWPORT_CONFIG.nudge.coverFadeMs);
}
