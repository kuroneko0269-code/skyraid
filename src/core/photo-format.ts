// フォトモード（7-A）の UI の値の変換（Three.js・DOM 非依存）: ピントの距離のスライダー（対数）・時刻の表示
import { PHOTO_FOCUS } from '../data/photo';

/** スライダーの目盛り（0〜1000） */
const FOCUS_STEPS = 1000;

/** スライダー（0〜1000）→ ピントの距離（m。2〜2000m を対数で） */
export function focusFromSlider(v: number): number {
  const { minDistance: a, maxDistance: b } = PHOTO_FOCUS;
  const t = Math.min(1, Math.max(0, v / FOCUS_STEPS));
  return a * Math.pow(b / a, t);
}

export function focusToSlider(distance: number): number {
  const { minDistance: a, maxDistance: b } = PHOTO_FOCUS;
  const d = Math.min(b, Math.max(a, distance));
  return Math.round((Math.log(d / a) / Math.log(b / a)) * FOCUS_STEPS);
}

/** 時刻（0〜24）→ 「15:30」 */
export function formatHour(h: number): string {
  const m = Math.round(Math.min(24, Math.max(0, h)) * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
