// HUD の表示切替（1-4 / 2-4）: H キーとポーズメニューの設定の「HUD ON/OFF」。ミッションの HUD も合わせる。
// 3-1 から表示 / 非表示をセーブの設定に保存する
import type { SaveStore } from '../progression/save-store';
import type { Hud } from './hud';
import type { MissionHud } from './mission-hud';
import { createToggleButton } from './mobile';

export interface HudToggle {
  /** 切り替える（H キー）。設定のボタンの表示も合わせる */
  toggle(): void;
}

export function createHudToggle(
  panel: HTMLElement,
  hud: Hud,
  missionHud: MissionHud,
  save: SaveStore,
): HudToggle {
  const apply = (visible: boolean): boolean => {
    hud.setVisible(visible);
    missionHud.setHudVisible(visible);
    save.setSetting('hud', visible);
    return visible;
  };
  apply(save.settings.hud);
  const button = createToggleButton(panel, 'HUD', hud.visible, () => apply(!hud.visible));
  return {
    toggle: () => {
      button.sync(apply(!hud.visible));
    },
  };
}
