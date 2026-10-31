// 入力（キーボード・ゲームパッド）・HUD・ポーズメニューの表示の設定・デバッグ表示・共通キーをまとめて作る
// （main.ts から分けた。7-A の事前修正。挙動は変えていない）
import { CommonKeys } from '../core/common-keys';
import { parseDebugFlags } from '../core/debug-flags';
import type { GameState } from '../core/game-state';
import { GamepadInput, browserGamepads } from '../core/gamepad';
import { Input } from '../core/input';
import type { StorageLike } from '../core/settings';
import type { SaveStore } from '../progression/save-store';
import { DebugLink } from '../render/debug-link';
import type { RenderPipeline } from '../render/pipeline';
import type { World } from '../render/scene';
import { Hud } from './hud';
import { MissionHud } from './mission-hud';
import type { Screens } from './screens';
import { createDisplaySettings } from './settings-link';

export interface AppControlParts {
  readonly game: GameState;
  readonly screens: Screens;
  readonly save: SaveStore;
  readonly storage: StorageLike;
  readonly pipeline: RenderPipeline;
  readonly world: World;
}

export function createAppControls(p: AppControlParts) {
  const { game, screens, save } = p;
  const input = new Input();
  input.attach(window);

  // ゲームパッド: 接続されたら自動で読む
  const gamepad = new GamepadInput(input, browserGamepads);
  gamepad.attach(window);

  const hud = new Hud(document.body);
  const missionHud = new MissionHud(document.body);
  // ポーズメニューの設定: タッチ・HUD・全画面（ここ）→ 敵・操作補助・セーブデータ（セッションの後）
  const settingsParts = {
    panel: screens.pause.settings,
    input,
    storage: p.storage,
    save,
    hud,
    missionHud,
    modeSelect: screens.modeSelect,
    inFlight: () => game.state === 'flight',
  };
  const { touch, hudToggle } = createDisplaySettings(settingsParts);

  // ?debug でデバッグ表示を初期表示、?debug=input で押したアクション名をコンソールに出す
  const debugFlags = parseDebugFlags(window.location.search);
  const debug = new DebugLink(document.body, debugFlags.overlay, p.pipeline, p.world);
  const back = screens.navigateBack.bind(screens, game);
  const keys = new CommonKeys(input, gamepad, { debug, hud: hudToggle }, back, debugFlags.logInput);
  return { input, gamepad, hud, missionHud, settingsParts, touch, debug, keys };
}
