// フォトモード（7-A）の撮影ボタンの後: シャッター音・白いフラッシュ・保存（render/photo/photo-shot.ts）・お知らせ
// （photo-link.ts から分けた）
import type { GameAudio } from '../../audio/game-audio';
import { PHOTO_UI, type PhotoResolution } from '../../data/photo';
import { takePhoto } from '../../render/photo/photo-shot';
import type { RenderPipeline } from '../../render/pipeline';

/** お知らせを出しておく時間（ms） */
const TOAST_MS = 1600;

export class PhotoShutter {
  private shooting = false;
  private readonly flash: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private toastTimer = 0;

  constructor(
    private readonly pipeline: RenderPipeline,
    private readonly audio: GameAudio,
  ) {
    this.flash = document.createElement('div');
    this.flash.className = 'photo-flash';
    this.flash.style.setProperty('--photo-flash', `${PHOTO_UI.flashSeconds}s`);
    this.toast = document.createElement('div');
    this.toast.className = 'ui-toast photo-toast';
    this.toast.hidden = true;
    document.body.append(this.flash, this.toast);
  }

  /** 撮って保存する（撮っている間の 2 回目は無視） */
  async shoot(resolution: PhotoResolution, mobile: boolean, watermark: boolean): Promise<void> {
    if (this.shooting) return;
    this.shooting = true;
    this.audio.playShutter();
    try {
      const result = await takePhoto(this.pipeline, { resolution, mobile, watermark });
      this.flashOnce();
      if (result !== 'cancel') this.showToast(result === 'share' ? '共有しました' : '保存しました');
    } catch {
      this.showToast('保存できませんでした');
    } finally {
      this.shooting = false;
    }
  }

  hideToast(): void {
    this.toast.hidden = true;
  }

  private flashOnce(): void {
    const f = this.flash;
    f.classList.add('is-on');
    requestAnimationFrame(() => {
      f.classList.remove('is-on');
    });
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.hidden = true;
    }, TOAST_MS);
  }
}
