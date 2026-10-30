// タッチ操作の表示の配線（1-5 / 1-6）: 自動（pointer: coarse のときだけ）/ 強制表示 / 強制非表示。
// 設定は localStorage（ポーズメニューの設定）。飛行中だけ出す
import type { Input } from '../core/input';
import type { StorageLike } from '../core/settings';
import { loadTouchMode, saveTouchMode, shouldShowTouchControls } from '../core/touch-settings';
import { createRotateHint, createTouchModeSelect } from './mobile';
import { TouchControls } from './touch-controls';

export interface TouchLink {
  readonly controls: TouchControls;
  /** 表示を今の画面状態・設定に合わせる（画面の遷移のたびに呼ぶ） */
  refresh(): void;
}

export function createTouchLink(
  parent: HTMLElement,
  input: Input,
  storage: StorageLike | null,
  settingsPanel: HTMLElement,
  inFlight: () => boolean,
): TouchLink {
  const controls = new TouchControls(parent, input);
  createRotateHint(parent);
  let mode = loadTouchMode(storage);
  const coarsePointer =
    typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
  const refresh = (): void => {
    controls.setVisible(
      inFlight() && shouldShowTouchControls(mode, coarsePointer?.matches ?? false),
    );
  };
  refresh();
  coarsePointer?.addEventListener('change', refresh);
  createTouchModeSelect(settingsPanel, mode, (m) => {
    mode = m;
    saveTouchMode(storage, m);
    refresh();
  });
  window.addEventListener('blur', () => {
    controls.reset();
  });
  return { controls, refresh };
}
