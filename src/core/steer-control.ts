// 「方向へ倒す」方式（9-2）の入力の側: タッチのスティックがこの方式で、最後に操作したのがタッチのとき、操縦の入力（ピッチ・
// ロール・ヨー）を DirectSteer で組み立てて上書きする。固定ステップごと、操縦の入力を読んだ後・エイムアシストの前に呼ぶ。
// 記録（リプレイ）は組み立てた後の入力を残すので、方式によらず同じ結果で再生できる
import type { AircraftSpec } from '../data/aircraft';
import type { AircraftControls, GroundHeightFn } from '../entities/aircraft';
import { DirectSteer, type SteerCommand } from '../flight/direct-steer';
import type { FlightOptions, FlightState } from '../flight/flight-model';
import type { Input } from './input';

/** 組み立てに使う自機（FlightSession の aircraft。PvP も同じ機体） */
export interface SteerAircraft {
  readonly state: FlightState;
  readonly flight: { readonly options: Readonly<FlightOptions>; readonly spec: AircraftSpec };
}

export class SteerControl {
  private readonly steer = new DirectSteer();
  private readonly command: SteerCommand = { pitch: 0, roll: 0, yaw: 0 };

  constructor(
    private readonly input: Input,
    private readonly aircraft: SteerAircraft,
    private readonly ground: GroundHeightFn,
  ) {}

  /** 「方向へ倒す」方式で組み立てているか */
  get active(): boolean {
    return this.input.directMode && this.input.lastDevice === 'touch';
  }

  /** 宙返り（9-3）の途中か */
  get looping(): boolean {
    return this.steer.loop.active;
  }

  /** 上へ端まで倒しているのに、速さが足りなくて宙返りに入れない（HUD の「速度不足」） */
  get loopBlocked(): boolean {
    return this.steer.loop.blocked;
  }

  /** 宙返りの途中の状態を捨てる（飛行の始め・復帰） */
  reset(): void {
    this.steer.reset();
  }

  apply(controls: AircraftControls): void {
    if (!this.active) {
      this.steer.reset();
      return;
    }
    const input = this.input;
    const { x, y } = input.directStick;
    // 感度（4-11）: 合成の大きさに掛けて 1 で頭打ち（向きは保つ）
    const len = Math.hypot(x, y);
    const k = len > 0 ? Math.min(1, len * input.stickSensitivity) / len : 0;
    const a = this.aircraft;
    const c = this.steer.apply(this.command, a.state, x * k, y * k, this.ground, a.flight.spec);
    // 飛行モデルがピッチ反転を掛けるので、先に戻しておく（この方式は「画面の上へ倒す = 上がる」で反転しない）
    controls.pitch = this.aircraft.flight.options.invertPitch ? -c.pitch : c.pitch;
    controls.roll = c.roll;
    // ヨーのボタン（◀ ▶）は足す
    controls.yaw = Math.min(1, Math.max(-1, c.yaw + input.axis('yawLeft', 'yawRight')));
  }
}
