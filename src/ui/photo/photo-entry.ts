// フォトモード（7-A）の入口（8-2）: フォトモードの本体（photo-link.ts 以下・カメラ・ツールバー・撮影）は別のチャンクにし、
// 初めて入るときに読む（モード選択を開いたときに先読みもする）。ポーズメニューの「フォトモード」・P キー・リプレイの「撮影」は
// ここを通る。状態の変化のつなぎは起動時に付け（並びを 7-A と同じにするため）、読み込んだ後は本体に渡す
import { lazyChunk } from '../../core/lazy-chunk';
import type { FlightFrame } from '../../render/flight-frame';
import { loadChunk, prefetchChunk } from '../lazy-load';
import type { PhotoLink, PhotoLinkParts } from './photo-link';

export class PhotoEntry {
  private link: PhotoLink | null = null;
  private readonly chunk = lazyChunk(() => import('./photo-link'));

  constructor(
    private readonly p: PhotoLinkParts,
    private readonly frame: FlightFrame,
  ) {
    p.game.onChange(({ from, to }) => {
      this.link?.changed(from, to);
    });
    p.pause.onPhoto = () => {
      void this.enter();
    };
    p.game.onChange(({ to }) => {
      if (to === 'pause') p.pause.setPhotoAvailable(p.allowed());
    });
  }

  /** 本体を先に読んでおく（表示なし。失敗しても入るときにやり直す） */
  prefetch(): void {
    prefetchChunk(this.chunk);
  }

  /** フォトモードに入れるか（飛行中・ポーズ中で、許された遊び方） */
  private canEnter(): boolean {
    const s = this.p.game.state;
    return (s === 'flight' || s === 'pause') && this.p.allowed();
  }

  /** P キー・リプレイの「撮影」: 入る / 出る */
  toggle(): void {
    if (this.p.game.state === 'photo') this.p.game.transition('flight');
    else void this.enter();
  }

  /** タッチ操作をフォトモードで出すか */
  get showsTouch(): boolean {
    return this.link?.showsTouch ?? false;
  }

  /** 入る（初回は読み込んでから。読み込む間に飛行を離れたら入らない） */
  private async enter(): Promise<void> {
    if (!this.canEnter()) return;
    if (!this.link) {
      const m = await loadChunk(this.chunk);
      if (!m || !this.canEnter()) return;
      this.link ??= new m.PhotoLink(this.p);
      this.frame.photo = this.link;
    }
    this.p.game.transition('photo');
  }
}

/** フォトモードの入口を作り、ポーズメニューの「フォトモード」をつなぐ（P キーは common-keys の toggle） */
export function createPhotoMode(p: PhotoLinkParts, frame: FlightFrame): PhotoEntry {
  return new PhotoEntry(p, frame);
}
