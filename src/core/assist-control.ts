// 操作補助のうち入力・判定の側（4-12）: エイムアシストと機銃の当たり判定の拡大。どちらもタッチ・パッドで操作しているときだけ。
// 固定ステップごと、操縦の入力を読んだ後・ゲームを進める前に呼ぶ
import { applyAimAssist } from '../combat/aim-assist';
import { AIM_ASSIST_CONFIG } from '../data/assist';
import type { AircraftControls } from '../entities/aircraft';
import type { FlightSession } from '../missions/flight-session';
import type { AssistFlags } from './assist-settings';
import type { InputDevice } from './input';

export class AssistControl {
  constructor(
    private readonly session: FlightSession,
    private readonly flags: Readonly<AssistFlags>,
    private readonly device: () => InputDevice,
  ) {}

  /** タッチ・パッドで操作していて、エイムアシストが ON */
  get active(): boolean {
    return this.flags.aim && this.device() !== 'keyboard';
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
    );
  }
}
