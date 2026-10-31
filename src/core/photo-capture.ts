// フォトモード（7-A）の保存（Three.js・DOM 非依存の部分）: 解像度の選択・透かしの配置・ファイル名・保存の方法
import {
  PHOTO_CAPTURE,
  PHOTO_RESOLUTIONS,
  PHOTO_WATERMARK,
  type PhotoResolution,
} from '../data/photo';

export interface CaptureSize {
  width: number;
  height: number;
}

/** 端末で選べる解像度（スマホは 2 倍まで） */
export function availableResolutions(mobile: boolean): readonly PhotoResolution[] {
  return mobile ? PHOTO_RESOLUTIONS.filter((r) => r !== 'uhd') : PHOTO_RESOLUTIONS;
}

/** 選べない解像度は選べる中で一番大きいものにする */
export function resolveResolution(choice: PhotoResolution, mobile: boolean): PhotoResolution {
  const list = availableResolutions(mobile);
  return list.includes(choice) ? choice : (list[list.length - 1] ?? 'screen');
}

/**
 * 保存する画像の大きさ（px）。画面サイズ = 画面の CSS px、2 倍 = その 2 倍、4K = 長辺 3840px（縦横比は画面のまま）。
 * どれも GPU の上限（maxSide）に収める
 */
export function captureSize(
  choice: PhotoResolution,
  cssWidth: number,
  cssHeight: number,
  mobile: boolean,
  gpuMaxSide: number = PHOTO_CAPTURE.maxSide,
): CaptureSize {
  const w = Math.max(1, cssWidth);
  const h = Math.max(1, cssHeight);
  const r = resolveResolution(choice, mobile);
  let scale = 1;
  if (r === 'double') scale = 2;
  else if (r === 'uhd') scale = PHOTO_CAPTURE.uhdLongSide / Math.max(w, h);
  const limit = Math.min(PHOTO_CAPTURE.maxSide, gpuMaxSide);
  scale = Math.min(scale, limit / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** 透かしの文字の大きさと位置（右下、右揃え・下揃えの基準点） */
export function watermarkLayout(
  width: number,
  height: number,
): { fontPx: number; x: number; y: number } {
  const short = Math.min(width, height);
  const m = Math.round(short * PHOTO_WATERMARK.margin);
  return {
    fontPx: Math.max(10, Math.round(short * PHOTO_WATERMARK.size)),
    x: width - m,
    y: height - m,
  };
}

/** ファイル名（例 skyraid-20261031-153012.png） */
export function photoFileName(prefix: string, date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const d = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  const t = `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${prefix}-${d}-${t}.png`;
}

/** 保存の方法: スマホでファイルを共有できれば Web Share API、それ以外は download 属性 */
export function saveMethod(mobile: boolean, canShareFiles: boolean): 'share' | 'download' {
  return mobile && canShareFiles ? 'share' : 'download';
}
