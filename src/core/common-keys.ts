// 飛行中・メニュー中どちらでも効くキー（F3 / H）と入力ログ、メニュー中の戻る（Esc / Start）。
// main.ts から分けた（4-11。挙動は変えていない）
import { ACTIONS } from '../data/keybinds';
import type { GamepadInput } from './gamepad';
import type { Input } from './input';

interface Toggle {
  toggle(): void;
}

export class CommonKeys {
  constructor(
    private readonly input: Input,
    private readonly gamepad: GamepadInput,
    /** F3: デバッグ表示 / H: HUD */
    private readonly toggles: { readonly debug: Toggle; readonly hud: Toggle },
    /** Esc / Start（メニュー中）: ポーズ → 再開、モード選択 → タイトルなど 1 つ前の画面へ */
    private readonly back: () => void,
    /** ?debug=input: 押したアクション名をコンソールに出す */
    private readonly logInput: boolean,
  ) {}

  /** 固定更新 1 回分の終わりに呼ぶ（押した瞬間の判定もここでリセット） */
  handle(): void {
    const input = this.input;
    if (input.wasPressed('debugToggle')) this.toggles.debug.toggle();
    if (input.wasPressed('hudToggle')) this.toggles.hud.toggle();
    if (this.logInput) {
      for (const action of ACTIONS) {
        if (input.wasPressed(action)) console.info(`[input] ${action}`);
      }
    }
    input.endStep();
  }

  /** 固定更新が止まっている間（タイトル・モード選択・ポーズ）の入力。描画フレームごとに呼ぶ */
  readonly menuTick = (): void => {
    this.gamepad.poll();
    if (this.input.wasPressed('pause')) this.back();
    this.handle();
  };
}
