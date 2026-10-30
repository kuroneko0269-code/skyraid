// 入力 → 戦闘の操作（CombatInput）の読み替え（2-6 で main.ts から分けた。Three.js 非依存）。
// タッチ・パッドは武器のボタンが足りないので長押しを使う:
// - タッチの MSL（secondary）: 短く押して離すと今の兵装（ミサイル / ロケット）を撃ち、holdSeconds 押し続けると兵装を切り替える（撃たない）
// - タッチの AB・パッドの RT（bombHold）: holdSeconds 押し続けると爆弾を 1 発（押し直すまで次は落とさない）。
//   AB・ヨーと兼ねるので、投下は着弾予測点が出ているときだけ（CombatSystem が bombHeld を見て判断する）
import type { CombatInput } from '../combat/combat-system';
import { WEAPON_INPUT_CONFIG } from '../data/ordnance';
import type { Action } from '../data/keybinds';

/** タッチの MSL ボタンで撃つ兵装 */
export type SecondaryWeapon = 'missile' | 'rocket';

/** Input のうち読む部分（テストでは偽物を渡す） */
export interface ActionReader {
  isDown(action: Action): boolean;
  wasPressed(action: Action): boolean;
}

/** 押している時間を数え、holdSeconds に届いた瞬間を 1 回だけ知らせる */
class HoldTimer {
  held = 0;
  fired = false;

  /** このステップで押されているなら dt を足す。押し続けて holdSeconds に届いたステップだけ 'hold' */
  step(down: boolean, dt: number, holdSeconds: number): 'hold' | 'tap' | null {
    if (down) {
      this.held += dt;
      if (!this.fired && this.held >= holdSeconds - 1e-9) {
        this.fired = true;
        return 'hold';
      }
      return null;
    }
    const tap = this.held > 0 && !this.fired;
    this.held = 0;
    this.fired = false;
    return tap ? 'tap' : null;
  }
}

export class WeaponInput {
  /** タッチの MSL ボタンで撃つ兵装（HUD・ボタンの文字に出す） */
  secondary: SecondaryWeapon = 'missile';
  private readonly secondaryHold = new HoldTimer();
  private readonly bombHold = new HoldTimer();

  constructor(private readonly holdSeconds: number = WEAPON_INPUT_CONFIG.holdSeconds) {}

  /** 固定ステップ 1 回分の操作を out に書く */
  read(input: ActionReader, out: CombatInput, dt: number): void {
    out.trigger = input.isDown('fire');
    out.missile = input.wasPressed('missile');
    out.flare = input.wasPressed('flare');
    out.targetNext = input.wasPressed('targetNext');
    out.rocket = input.wasPressed('rocket');
    out.bomb = input.wasPressed('bomb');
    // ステップの間に押して離した短いタップも、押したステップに数える
    const secondaryDown = input.isDown('secondary');
    const tapped = !secondaryDown && input.wasPressed('secondary');
    const s = this.secondaryHold.step(secondaryDown || tapped, dt, this.holdSeconds);
    const s2 = tapped ? this.secondaryHold.step(false, dt, this.holdSeconds) : null;
    if (s === 'hold') this.secondary = this.secondary === 'missile' ? 'rocket' : 'missile';
    if (s === 'tap' || s2 === 'tap') {
      if (this.secondary === 'missile') out.missile = true;
      else out.rocket = true;
    }
    out.bombHeld = this.bombHold.step(input.isDown('bombHold'), dt, this.holdSeconds) === 'hold';
  }

  /** 押している時間を忘れる（飛行の開始・ポーズからの再開） */
  reset(): void {
    for (const h of [this.secondaryHold, this.bombHold]) {
      h.held = 0;
      h.fired = false;
    }
  }
}
