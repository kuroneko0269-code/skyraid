// WebGL のコンテキスト喪失（8-3。iOS でアプリを裏に回したとき・GPU のリセットなど）:
// 失ったら飛行中はポーズにする（描けない間に墜落しないように）。three は喪失中の描画を飛ばし、戻ると GPU の資源を作り直す。
// 1 回だけ焼いて使う資源（空の環境マップ）は scene.ts が復帰のイベントで焼き直す。
// 一定時間で戻らなければ「再読み込み」のお知らせを出す
import { COMPAT_CONFIG } from '../data/compat';
import { showToast, type Toast } from './toast';

export interface ContextLossHooks {
  /** 失ったときに止めるか（ソロの飛行中。PvP・協力は止められないのでそのまま） */
  readonly shouldPause: () => boolean;
  readonly pause: () => void;
}

export function linkContextLoss(canvas: HTMLCanvasElement, hooks: ContextLossHooks): void {
  let timer = 0;
  let toast: Toast | null = null;
  canvas.addEventListener('webglcontextlost', (e) => {
    // 既定の動き（戻さない）を止めて、復帰を待つ（three も同じことをする）
    e.preventDefault();
    if (hooks.shouldPause()) hooks.pause();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      toast ??= showToast(COMPAT_CONFIG.contextLostNotice, {
        seconds: 0,
        actions: [
          {
            label: '再読み込み',
            kind: 'primary',
            onClick: () => {
              location.reload();
            },
          },
          { label: '閉じる' },
        ],
      });
    }, COMPAT_CONFIG.contextRestoreTimeoutMs);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    window.clearTimeout(timer);
    toast?.close();
    toast = null;
  });
}
