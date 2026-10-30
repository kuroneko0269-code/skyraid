// ポーズメニューの設定の組み立て（main.ts から分けた。4-11 の事前修正。並びと挙動は変えていない）:
// タッチ・HUD・全画面・敵・操作補助・セーブデータ。画質（先頭）と音量（セーブデータの上）は各モジュールが入れる
import type { AssistFlags } from '../core/assist-settings';
import type { Input } from '../core/input';
import type { StorageLike } from '../core/settings';
import type { FlightSession } from '../missions/flight-session';
import type { SaveStore } from '../progression/save-store';
import { createAssistSettings } from './assist-settings';
import { createEnemySettings } from './enemy-settings';
import type { Hud } from './hud';
import { createHudToggle, type HudToggle } from './hud-toggle';
import type { MissionHud } from './mission-hud';
import { createFullscreenButton } from './mobile';
import type { ModeSelectScreen } from './mode-select';
import { createSaveSettings } from './save-settings';
import { createTouchLink, type TouchLink } from './touch-link';

export interface PauseSettingsParts {
  readonly panel: HTMLElement;
  readonly input: Input;
  readonly storage: StorageLike;
  readonly save: SaveStore;
  readonly hud: Hud;
  readonly missionHud: MissionHud;
  readonly modeSelect: ModeSelectScreen;
  /** 飛行中か（タッチ操作は飛行中だけ出す） */
  readonly inFlight: () => boolean;
}

/** タッチ・HUD・全画面の設定を置く（飛行のセッションを作る前に呼ぶ） */
export function createDisplaySettings(p: PauseSettingsParts): {
  touch: TouchLink;
  hudToggle: HudToggle;
} {
  // タッチ操作（自動 / 強制表示 / 強制非表示）。飛行中だけ出す
  const touch = createTouchLink(document.body, p.input, p.storage, p.panel, p.inFlight);
  // HUD: H キー / ポーズメニューの設定のボタンで表示切替（3-1 から保存）。ミッションの HUD（2-4）も合わせる
  const hudToggle = createHudToggle(p.panel, p.hud, p.missionHud, p.save);
  createFullscreenButton(p.panel);
  return { touch, hudToggle };
}

/**
 * 敵・操作補助・セーブデータの設定を置く（飛行のセッションを作った後に呼ぶ）。
 * 返す操作補助（4-12）の flags は変更のたびに書き換わる（毎フレーム読む）
 */
export function createGameSettings(p: PauseSettingsParts, session: FlightSession): AssistFlags {
  // 敵の有無・難易度（ポーズメニューの設定。セーブに保存）
  createEnemySettings(p.panel, p.storage, (enabled, difficulty) => {
    session.configureEnemies(enabled, difficulty);
    p.modeSelect.setEnemiesEnabled(enabled);
  });
  // 操作補助（4-12）: エイムアシスト（タッチ・パッドだけ）・ターゲットカメラ・HUD 補助。ポーズメニューの設定で OFF にできる
  const assistFlags = createAssistSettings(p.panel, p.storage);
  // 設定の最下部: セーブデータのコピー / 復元 / 削除。復元・削除の後は読み込み直して新しいセーブで始める
  createSaveSettings(p.panel, p.save);
  return assistFlags;
}
