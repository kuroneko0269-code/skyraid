// 操作補助のうち入力・判定の側（4-12）: エイムアシストと機銃の当たり判定の拡大。どちらもタッチ・パッドで操作しているときだけ。
// 9-3: タッチは狙いの補助の強さ（弱・標準・強）と自動射撃を設定から（パッドは今までどおり弱 = 4-12 の値・自動射撃なし）。
// 9-5b: タッチの速度合わせ（設定から。パッド・キーボードは無し）。
// ネット対戦（個人戦・チーム戦）は部屋の補正（Modifiers）が OFF なら弱・自動射撃なし（協力は設定のまま）。
// 固定ステップごと、操縦の入力を読んだ後・ゲームを進める前に呼ぶ（apply → 武器の入力を読んだ後に applyFire）
import { autoFireReady } from '../combat/auto-fire';
import type { CombatInput } from '../combat/combat-input';
import { applyAimAssist } from '../combat/aim-assist';
import { SpeedMatch } from '../combat/speed-match';
import {
  AIM_ASSIST_CONFIG,
  AIM_ASSIST_DEFAULT_LEVEL,
  AIM_ASSIST_LEVEL_SPECS,
  AUTO_FIRE_CONFIG,
  SPEED_MATCH_CONFIG,
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
  /** 速度合わせ（9-5b） */
  readonly speedMatch: boolean;
}

/**
 * ネット対戦の部屋の補正（9-3。ホストがロビーで決める）: 狙いの補助・自動射撃を各自の設定どおりに効かせるか。
 * 9-5b: 速度合わせは「狙いの補助」の補正に含める（OFF なら効かない）
 */
export interface NetAssistRules {
  readonly aimAssist: boolean;
  readonly autoFire: boolean;
}

/** 設定を渡さないとき（テスト）の初期値 */
const DEFAULT_TOUCH: TouchAssistSettings = {
  aimAssist: AIM_ASSIST_DEFAULT_LEVEL,
  autoFire: AUTO_FIRE_CONFIG.defaultOn,
  speedMatch: SPEED_MATCH_CONFIG.defaultOn,
};

export class AssistControl {
  /** ネット対戦の飛行中の部屋の補正（null はソロ・協力 = 設定のまま。app.ts が入れる） */
  netRules: () => NetAssistRules | null = () => null;
  private readonly speed = new SpeedMatch();

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

  /** 速度合わせが効くか（9-5b。タッチで設定が ON。部屋の補正の「狙いの補助」が OFF のネット対戦は無し） */
  get speedMatchOn(): boolean {
    if (this.device() !== 'touch') return false;
    if (this.netRules()?.aimAssist === false) return false;
    return this.touchSettings().speedMatch;
  }

  /** 速度合わせでスロットルを下げているか（HUD の AUTO） */
  get speedMatching(): boolean {
    return this.speed.engaged;
  }

  /** 速度合わせ（9-5b）: 操縦の入力を組み立てた後・記録の前に。効かないときは状態を捨てる */
  applyThrottle(controls: AircraftControls): void {
    if (!this.speedMatchOn) {
      this.speed.reset();
      return;
    }
    this.speed.apply(controls, this.session);
  }

  /** 飛行の始め・復帰で、速度合わせの途中の状態を捨てる */
  resetThrottle(): void {
    this.speed.reset();
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
    input.autoTrigger = false;
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
    input.autoTrigger = input.trigger;
  }
}
