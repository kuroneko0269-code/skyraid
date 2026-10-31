// HUD の表示可否を <html data-hud> に書く（7-5b）。CSS は :root:not([data-hud]) で HUD 類を隠す。
// 夜の減光（7-5）は --hud-night-opacity で渡し、インラインの opacity は使わない（これが隠す CSS を上書きしていた）
import { hudVisibleOn, type ScreenState } from '../core/game-state';

/** 画面状態とフォトモードの HUD 表示（data-photo-hud）から data-hud を付け外しする */
export function syncHudScreen(root: HTMLElement, state: ScreenState): void {
  if (hudVisibleOn(state, root.dataset.photoHud !== undefined)) root.dataset.hud = '';
  else delete root.dataset.hud;
}
