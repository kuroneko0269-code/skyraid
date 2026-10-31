// フォトモード（7-A）の撮影: レンダラーの出力を選んだ解像度で描き、透かし「SkyRaid」を右下に入れて PNG にし、
// スマホは Web Share API（ファイルを共有できるとき）、それ以外は download 属性で保存する
import { captureSize, photoFileName, saveMethod, watermarkLayout } from '../../core/photo-capture';
import { PHOTO_UI, PHOTO_WATERMARK, type PhotoResolution } from '../../data/photo';
import type { RenderPipeline } from '../pipeline';

export interface ShotOptions {
  readonly resolution: PhotoResolution;
  readonly mobile: boolean;
  readonly watermark: boolean;
}

/** 撮って保存する。保存できたら 'share' / 'download'、共有を取り消したら 'cancel' */
export async function takePhoto(
  pipeline: RenderPipeline,
  o: ShotOptions,
): Promise<'share' | 'download' | 'cancel'> {
  const size = captureSize(
    o.resolution,
    window.innerWidth,
    window.innerHeight,
    o.mobile,
    pipeline.maxCaptureSide,
  );
  const canvas = pipeline.capture(size.width, size.height);
  if (o.watermark) drawWatermark(canvas);
  const blob = await toPng(canvas);
  const name = photoFileName(PHOTO_UI.filePrefix, new Date());
  const file = new File([blob], name, { type: 'image/png' });
  const canShare =
    typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  if (saveMethod(o.mobile, canShare) === 'share') {
    try {
      await navigator.share({ files: [file], title: 'SkyRaid' });
      return 'share';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancel';
      // 共有できなければダウンロードにする
    }
  }
  download(blob, name);
  return 'download';
}

function drawWatermark(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const l = watermarkLayout(canvas.width, canvas.height);
  ctx.save();
  ctx.font = `600 ${l.fontPx}px Rajdhani, system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.globalAlpha = PHOTO_WATERMARK.alpha;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = l.fontPx * 0.25;
  ctx.fillStyle = '#fff';
  ctx.fillText(PHOTO_WATERMARK.text, l.x, l.y);
  ctx.restore();
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('PNG を作れませんでした'));
    }, 'image/png');
  });
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // クリックの処理が終わってから解放する
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
