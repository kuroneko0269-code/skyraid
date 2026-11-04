// 操作補助のうち入力・判定の側（4-12）: エイムアシストと機銃の当たり判定の拡大。どちらもタッチ・パッドで操作しているときだけ。
// 9-3: タッチは狙いの補助の強さ（弱・標準・強）と自動射撃を設定から（パッドは今までどおり弱 = 4-12 の値・自動射撃なし）。
// ネット対戦（個人戦・チーム戦）は部屋の補正（Modifiers）が OFF なら弱・自動射撃なし（協力は設定のまま）。
// 固定ステップごと、操縦の入力を読んだ後・ゲームを進める前に呼ぶ（apply → 武器の入力を読んだ後に applyFire）
import { autoFireReady } from '../combat/auto-fire';
import type { CombatInput } from '../combat/combat-input';
import { applyAimAssist } from '../combat/aim-assist';
import {
  AIM_ASSIST_CONFIG,
  AIM_ASSIST_DEFAULT_LEVEL,
  AIM_ASSIST_LEVEL_SPECS,
  AUTO_FIRE_CONFIG,
  type AimAssistLevel,
  type AimAssistSpec,
} from '../data/assist';
import type { AircraftControls } from '../entities/aircraft';
import type { FlightSession } from '../missions/flight-session';
import type { AssistFlags } from './assist-settings';
import type { InputDevice } from './input';

/** タッチの補助の設定（セーブの settings.controls の一部） */
export interface TouchAssistSettings {
  readonly aimAssist: AimAssistLevel;
  readonly autoFire: boolean;
}

/** ネット対戦の部屋の補正（9-3。ホストがロビーで決める）: 狙いの補助・自動射撃を各自の設定どおりに効かせるか */
export interface NetAssistRules {
  readonly aimAssist: boolean;
  readonly autoFire: boolean;
}

/** 設定を渡さないとき（テスト）の初期値 */
const DEFAULT_TOUCH: TouchAssistSettings = {
  aimAssist: AIM_ASSIST_DEFAULT_LEVEL,
  autoFire: AUTO_FIRE_CONFIG.defaultOn,
};

export class AssistControl {
  /** ネット対戦の飛行中の部屋の補正（null はソロ・協力 = 設定のまま。app.ts が入れる） */
  netRules: () => NetAssistRules | null = () => null;

  constructor(
    private readonly session: FlightSession,
    private readonly flags: Readonly<AssistFlags>,
    private readonly device: () => InputDevice,
    private readonly touchSettings: () => TouchAssistSettings = () => DEFAULT_TOUCH,
  ) {}

  /** タッチ・パッドで操作していて、エイムアシストが ON */
  get active(): boolean {
    return this.flags.aim && this.device() !== 'keyboard';
  }

  /** 今の補正の数値（タッチは設定の強さ。パッド・部屋の補正が OFF のネット対戦は 4-12 の値） */
  get spec(): AimAssistSpec {
    if (this.device() !== 'touch') return AIM_ASSIST_CONFIG;
    if (this.netRules()?.aimAssist === false) return AIM_ASSIST_CONFIG;
    return AIM_ASSIST_LEVEL_SPECS[this.touchSettings().aimAssist];
  }

  /** 自動射撃が効くか（タッチで設定が ON。部屋の補正が OFF のネット対戦は無し） */
  get autoFire(): boolean {
    if (this.device() !== 'touch') return false;
    if (this.netRules()?.autoFire === false) return false;
    return this.touchSettings().autoFire;
  }

  apply(controls: AircraftControls): void {
    const s = this.session;
    const active = this.active;
    s.combat.gun.hitRadiusScale = active ? AIM_ASSIST_CONFIG.gunHitRadiusScale : 1;
    const target = s.combat.targeting.selected;
    if (!active || !target || !s.player.active) return;
    const combat = s.combat;
    const state = s.aircraft.state;
    const aim = combat.leadValid ? combat.lead : target.position;
    applyAimAssist(
      controls,
      state.position,
      state.orientation,
      aim,
      s.aircraft.flight.options.invertPitch,
      this.spec,
    );
  }

  /** 自動射撃（9-3）: 当たる範囲に入って射程内なら引き金を引く（ボタンで撃っていればそのまま） */
  applyFire(input: CombatInput): void {
    if (input.trigger || !this.autoFire) return;
    const s = this.session;
    if (!s.player.active) return;
    const c = s.combat;
    const st = s.aircraft.state;
    input.trigger = autoFireReady(
      c.targeting.selected,
      c.lead,
      c.leadValid,
      st.position,
      st.orientation,
      c.gun.hitRadiusScale,
    );
  }
}
