// 「情報」画面（7-D）の入口（8-2）: 情報画面はライセンスの本文が大きいので別のチャンクにし、初めて開くときに読む。
// Esc で閉じるつなぎは起動時に付ける（まだ作っていなければ何もしない）
import type { GameState } from '../core/game-state';
import { lazyChunk } from '../core/lazy-chunk';
import type { InfoScreen } from './info-screen';
import { loadChunk } from './lazy-load';
import type { ModeSelectScreen } from './mode-select';

export class InfoEntry {
  private screen: InfoScreen | null = null;
  private readonly chunk = lazyChunk(() => import('./info-screen'));

  constructor(
    private readonly parent: HTMLElement,
    private readonly modeSelect: ModeSelectScreen,
    private readonly game: GameState,
  ) {
    modeSelect.addOverlay(() => this.screen?.close() ?? false);
  }

  /** 開く（初回は読み込んでから。読み込む間にモード選択を離れたら開かない） */
  async show(): Promise<void> {
    const m = await loadChunk(this.chunk);
    if (!m || this.game.state !== 'mode_select') return;
    this.screen ??= m.InfoScreen.over(this.parent, this.modeSelect, this.game);
    this.screen.show();
  }
}
